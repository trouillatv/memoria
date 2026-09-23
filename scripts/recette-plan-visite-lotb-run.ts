import { config } from 'dotenv'
config({ path: '.env.local' })

import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

import { createSiteReserve, liftReserve } from '../lib/db/site-reserve'
import {
  createSiteAction,
  markSiteActionDone,
  reopenSiteAction,
  confirmSiteActionOpen,
  discardSiteAction,
} from '../lib/db/site-actions'
import {
  createSiteDecision,
  getSiteDecision,
  updateSiteDecision,
  deleteSiteDecision,
} from '../lib/db/site-decisions'
import { setObligationStatus } from '../lib/db/obligations'
import { setWatchlistItemState } from '../lib/db/visit-watchlist'
import {
  resolvePlanVisiteMutation,
  watchlistStateForVerdict,
  planVisiteVerdictRequiresComment,
  isValidPlanVisiteVerdict,
  type PlanVisiteVerdict,
} from '../lib/visits/plan-visite-verdict'
import {
  detectOverdueActions,
  detectUnappliedDecisions,
  detectOpenReserves,
} from '../lib/db/site-memory-signals'
import { detectNeglectedObligations } from '../lib/db/obligations'
import { resetSandboxSite } from '../lib/db/sandbox'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Manifest = {
  testRunId: string
  createdAt: string
  orgId: string
  siteId: string
  userId: string
  reportId: string
  actionIds: string[]
  decisionIds: string[]
  reserveIds: string[]
  obligationIds: string[]
  watchlistItemIds: string[]
}

const results: { scenario: string; detail: string; pass: boolean }[] = []
function record(scenario: string, pass: boolean, detail: string) {
  results.push({ scenario, pass, detail })
  console.log(`   [${pass ? 'PASS' : 'FAIL'}] ${scenario} — ${detail}`)
}

// Réplique de submitPlanVisiteVerdict (lib/visits/plan-visite-orchestrator.ts) SANS
// les gardes d'authentification HTTP (requireFieldAgent/requireOrganizationRole),
// impossibles hors contexte HTTP. actorId remplace auth.userId partout.
async function applyVerdictNoAuth(input: {
  watchlistItemId: string
  reportId: string
  siteId: string
  sourceKind: string
  sourceRef: string | null
  verdict: PlanVisiteVerdict
  comment?: string | null
  actorId: string
}): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const db = admin()
  const { watchlistItemId, reportId, siteId, sourceKind, sourceRef, verdict, actorId } = input
  const comment = input.comment ?? null

  if (!isValidPlanVisiteVerdict(sourceKind, verdict)) {
    return { ok: false, code: 'invalid_verdict', error: 'Verdict invalide' }
  }
  const mutation = resolvePlanVisiteMutation(sourceKind, verdict)
  if (!mutation) {
    return { ok: false, code: 'invalid_verdict', error: 'Verdict non applicable à ce type de point' }
  }
  if (planVisiteVerdictRequiresComment(sourceKind, verdict) && !comment) {
    return { ok: false, code: 'comment_required', error: 'Un commentaire est requis' }
  }
  if (mutation.kind !== 'constat' && !sourceRef) {
    return { ok: false, code: 'not_found', error: 'Source introuvable' }
  }

  switch (mutation.kind) {
    case 'lift_reserve': {
      const { data: reserve } = await db.from('site_reserve').select('id,status').eq('id', sourceRef!).eq('site_id', siteId).maybeSingle()
      if (!reserve) return { ok: false, code: 'not_found', error: 'Réserve introuvable' }
      if (reserve.status !== 'lifted') {
        await liftReserve({ id: sourceRef!, liftNote: comment, photoAfterPath: null, userId: actorId })
      }
      break
    }
    case 'complete_action': {
      const { data: action } = await db.from('site_actions').select('id,status').eq('id', sourceRef!).eq('site_id', siteId).maybeSingle()
      if (!action) return { ok: false, code: 'not_found', error: 'Action introuvable' }
      if (action.status === 'cancelled') return { ok: false, code: 'incompatible_state', error: 'Action annulée' }
      if (action.status !== 'done') {
        await markSiteActionDone(sourceRef!, { comment: comment ?? undefined }, actorId)
      }
      break
    }
    case 'confirm_action_open': {
      try {
        await confirmSiteActionOpen(sourceRef!, comment ?? '', actorId, { source: 'visit_watchlist', reportId, watchlistItemId })
      } catch {
        return { ok: false, code: 'incompatible_state', error: 'Confirmation impossible' }
      }
      break
    }
    case 'discard_action': {
      const { data: action } = await db.from('site_actions').select('id,status').eq('id', sourceRef!).eq('site_id', siteId).maybeSingle()
      if (!action) return { ok: false, code: 'not_found', error: 'Action introuvable' }
      if (action.status === 'done') return { ok: false, code: 'incompatible_state', error: 'Action déjà terminée' }
      if (action.status !== 'cancelled') {
        await discardSiteAction(sourceRef!, mutation.motif, comment ?? '', actorId)
      }
      break
    }
    case 'set_decision_statut': {
      const decision = await getSiteDecision(siteId, sourceRef!)
      if (!decision) return { ok: false, code: 'not_found', error: 'Décision introuvable' }
      const opposite = mutation.statut === 'appliquee' ? 'caduque' : 'appliquee'
      if (decision.statut === opposite) return { ok: false, code: 'incompatible_state', error: 'État opposé déjà actif' }
      if (decision.statut !== mutation.statut) {
        await updateSiteDecision(siteId, sourceRef!, { statut: mutation.statut })
      }
      break
    }
    case 'set_obligation_status': {
      const { data: ob } = await db.from('site_obligation').select('id,status').eq('id', sourceRef!).eq('site_id', siteId).maybeSingle()
      if (!ob) return { ok: false, code: 'not_found', error: 'Obligation introuvable' }
      const opposite = mutation.status === 'satisfaite' ? 'non_applicable' : 'satisfaite'
      if (ob.status === opposite) return { ok: false, code: 'incompatible_state', error: 'État opposé déjà actif' }
      if (ob.status !== mutation.status) {
        await setObligationStatus(sourceRef!, mutation.status, comment ?? undefined)
      }
      break
    }
    case 'constat':
      break
  }

  await setWatchlistItemState(watchlistItemId, watchlistStateForVerdict(verdict), comment, actorId)
  return { ok: true }
}

async function insertWatchlistItem(db: ReturnType<typeof admin>, input: {
  reportId: string
  siteId: string
  organizationId: string
  label: string
  sourceKind: string
  sourceRef: string | null
  position: number
  createdBy: string
}): Promise<string> {
  const { data, error } = await db
    .from('visit_watchlist_item')
    .insert({
      report_id: input.reportId,
      site_id: input.siteId,
      organization_id: input.organizationId,
      label: input.label,
      position: input.position,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef,
      priority: 'normal',
      reason: null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertWatchlistItem: ${error?.message}`)
  return data.id as string
}

async function getWatchlistState(db: ReturnType<typeof admin>, id: string): Promise<string | null> {
  const { data } = await db.from('visit_watchlist_item').select('state').eq('id', id).maybeSingle()
  return data?.state ?? null
}

async function main() {
  const db = admin()
  const testRunId = randomUUID()

  const { data: org } = await db.from('organizations').select('id').eq('slug', 'demo').maybeSingle()
  if (!org) throw new Error("Org 'demo' introuvable — impossible de lancer la recette sans chantier sandbox.")
  const orgId = org.id as string

  const { data: site } = await db
    .from('sites')
    .select('id,tenant_id,organization_id')
    .eq('organization_id', orgId)
    .eq('is_sandbox', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) throw new Error("Aucun site sandbox (is_sandbox=true) trouvé pour l'org 'demo'. Lancer scripts/dev/ensure-sandbox-site.ts d'abord.")
  const siteId = site.id as string

  let userId: string | null = null
  {
    const { data: preferred } = await db
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('role', ['chef_equipe', 'admin', 'manager'])
      .limit(1)
      .maybeSingle()
    userId = preferred?.user_id ?? null
    if (!userId) {
      const { data: any } = await db
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      userId = any?.user_id ?? null
    }
  }
  if (!userId) throw new Error("Aucun membre actif trouvé pour l'org 'demo'.")

  console.log(`── Setup : org=${orgId} site=${siteId} user=${userId}`)

  const { data: report, error: reportErr } = await db
    .from('site_reports')
    .insert({
      type: 'site',
      site_id: siteId,
      dossier_id: null,
      tenant_id: site.tenant_id,
      organization_id: site.organization_id,
      status: 'draft',
      created_by: userId,
      origin: 'spontaneous',
      source: null,
      visit_motive: null,
      objective: null,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (reportErr || !report) throw new Error(`Création site_reports: ${reportErr?.message}`)
  const reportId = report.id as string

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    orgId,
    siteId,
    userId,
    reportId,
    actionIds: [],
    decisionIds: [],
    reserveIds: [],
    obligationIds: [],
    watchlistItemIds: [],
  }

  const today = new Date()
  const pastDate = (daysAgo: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
  }

  let position = 0
  const wl = async (label: string, sourceKind: string, sourceRef: string | null) => {
    const id = await insertWatchlistItem(db, {
      reportId, siteId, organizationId: orgId, label, sourceKind, sourceRef, position: position++, createdBy: userId!,
    })
    manifest.watchlistItemIds.push(id)
    return id
  }

  // ---------- A. Action ----------
  console.log('\n── A1 Action Toujours à faire (négatif) reste ouverte')
  {
    const actionId = await createSiteAction({
      site_id: siteId, title: 'Recette A1 — action en retard', due_date: pastDate(5), due_date_status: 'explicit', created_by: userId,
    })
    manifest.actionIds.push(actionId)
    const itemId = await wl('Recette A1', 'action_overdue', actionId)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'negatif', actorId: userId })
    const { data: action } = await db.from('site_actions').select('status').eq('id', actionId).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectOverdueActions(siteId)
    const stillListed = signal?.items.some((i) => i.id === actionId) ?? false
    record('A1 Toujours à faire', r.ok === true && action?.status === 'open' && state === 'still_open' && stillListed,
      `verdict=${JSON.stringify(r)} action.status=${action?.status} watchlist=${state} detectorPresent=${stillListed}`)
  }

  console.log('\n── A2 Action Fait exige un commentaire puis clôture')
  {
    const actionId = await createSiteAction({
      site_id: siteId, title: 'Recette A2 — action en retard', due_date: pastDate(5), due_date_status: 'explicit', created_by: userId,
    })
    manifest.actionIds.push(actionId)
    const itemId = await wl('Recette A2', 'action_overdue', actionId)
    const r1 = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'positif', comment: null, actorId: userId })
    const gateOk = r1.ok === false && r1.code === 'comment_required'
    const r2 = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'positif', comment: 'Terminé sur site — recette A2', actorId: userId })
    const { data: action } = await db.from('site_actions').select('status').eq('id', actionId).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectOverdueActions(siteId)
    const gone = !(signal?.items.some((i) => i.id === actionId) ?? false)
    record('A2 Fait + commentaire', gateOk && r2.ok === true && action?.status === 'done' && state === 'checked' && gone,
      `gate=${JSON.stringify(r1)} verdict=${JSON.stringify(r2)} action.status=${action?.status} watchlist=${state} detectorAbsent=${gone}`)
  }

  console.log('\n── A3 Action Ne plus suivre exige un commentaire puis écarte')
  {
    const actionId = await createSiteAction({
      site_id: siteId, title: 'Recette A3 — action en retard', due_date: pastDate(5), due_date_status: 'explicit', created_by: userId,
    })
    manifest.actionIds.push(actionId)
    const itemId = await wl('Recette A3', 'action_overdue', actionId)
    const r1 = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'ne_plus_suivre', comment: null, actorId: userId })
    const gateOk = r1.ok === false && r1.code === 'comment_required'
    const r2 = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'ne_plus_suivre', comment: 'Doublon — recette A3', actorId: userId })
    const { data: action } = await db.from('site_actions').select('status').eq('id', actionId).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectOverdueActions(siteId)
    const gone = !(signal?.items.some((i) => i.id === actionId) ?? false)
    record('A3 Ne plus suivre + commentaire', gateOk && r2.ok === true && action?.status === 'cancelled' && state === 'dismissed_permanently' && gone,
      `gate=${JSON.stringify(r1)} verdict=${JSON.stringify(r2)} action.status=${action?.status} watchlist=${state} detectorAbsent=${gone}`)
  }

  console.log('\n── A4 Réouverture volontaire action écartée → redevient éligible')
  {
    const actionId = await createSiteAction({
      site_id: siteId, title: 'Recette A4 — action à réouvrir', due_date: pastDate(5), due_date_status: 'explicit', created_by: userId,
    })
    manifest.actionIds.push(actionId)
    const itemId = await wl('Recette A4', 'action_overdue', actionId)
    await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'action_overdue', sourceRef: actionId, verdict: 'ne_plus_suivre', comment: 'Écartée pour test réouverture', actorId: userId })
    const beforeReopenSignal = await detectOverdueActions(siteId)
    const absentBefore = !(beforeReopenSignal?.items.some((i) => i.id === actionId) ?? false)
    await reopenSiteAction(actionId, userId, 'Recette A4 — réouverture volontaire')
    const { data: action } = await db.from('site_actions').select('status').eq('id', actionId).maybeSingle()
    const afterReopenSignal = await detectOverdueActions(siteId)
    const presentAfter = afterReopenSignal?.items.some((i) => i.id === actionId) ?? false
    record('A4 Réouverture action', absentBefore && action?.status === 'open' && presentAfter,
      `absentAvant=${absentBefore} action.status=${action?.status} présentAprès=${presentAfter}`)
  }

  // ---------- D. Décision ----------
  console.log('\n── D1 Décision Appliquée → appliquee')
  {
    const decisionId = await createSiteDecision({
      siteId, reportId, titre: 'Recette D1', echeance: pastDate(5), createdBy: userId,
    })
    manifest.decisionIds.push(decisionId)
    const itemId = await wl('Recette D1', 'decision_unapplied', decisionId)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'decision_unapplied', sourceRef: decisionId, verdict: 'positif', actorId: userId })
    const decision = await getSiteDecision(siteId, decisionId)
    const state = await getWatchlistState(db, itemId)
    const signal = await detectUnappliedDecisions(siteId)
    const gone = !(signal?.items.some((i) => i.id === decisionId) ?? false)
    record('D1 Appliquée', r.ok === true && decision?.statut === 'appliquee' && state === 'checked' && gone,
      `verdict=${JSON.stringify(r)} decision.statut=${decision?.statut} watchlist=${state} detectorAbsent=${gone}`)
  }

  console.log('\n── D2 Décision Ne plus suivre → caduque')
  {
    const decisionId = await createSiteDecision({
      siteId, reportId, titre: 'Recette D2', echeance: pastDate(5), createdBy: userId,
    })
    manifest.decisionIds.push(decisionId)
    const itemId = await wl('Recette D2', 'decision_unapplied', decisionId)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'decision_unapplied', sourceRef: decisionId, verdict: 'ne_plus_suivre', actorId: userId })
    const decision = await getSiteDecision(siteId, decisionId)
    const state = await getWatchlistState(db, itemId)
    const signal = await detectUnappliedDecisions(siteId)
    const gone = !(signal?.items.some((i) => i.id === decisionId) ?? false)
    record('D2 Ne plus suivre', r.ok === true && decision?.statut === 'caduque' && state === 'dismissed_permanently' && gone,
      `verdict=${JSON.stringify(r)} decision.statut=${decision?.statut} watchlist=${state} detectorAbsent=${gone}`)

    console.log('\n── D3 Réouverture volontaire décision écartée → redevient éligible')
    await updateSiteDecision(siteId, decisionId, { statut: 'actee' })
    const decisionAfter = await getSiteDecision(siteId, decisionId)
    const signalAfter = await detectUnappliedDecisions(siteId)
    const presentAfter = signalAfter?.items.some((i) => i.id === decisionId) ?? false
    record('D3 Réouverture décision', decisionAfter?.statut === 'actee' && presentAfter,
      `decision.statut=${decisionAfter?.statut} présentAprès=${presentAfter}`)
  }

  // ---------- R. Réserve ----------
  console.log('\n── R1 Réserve Levée → lifted')
  {
    const { id: reserveId } = await createSiteReserve({
      siteId, label: 'Recette R1', location: 'Zone test', issuedBy: 'Recette', issuedOn: pastDate(10), userId, organizationId: orgId,
    })
    manifest.reserveIds.push(reserveId)
    const itemId = await wl('Recette R1', 'reserve_open', reserveId)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'reserve_open', sourceRef: reserveId, verdict: 'positif', actorId: userId })
    const { data: reserve } = await db.from('site_reserve').select('status').eq('id', reserveId).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectOpenReserves(siteId)
    const gone = !(signal?.items.some((i) => i.id === reserveId) ?? false)
    record('R1 Levée', r.ok === true && reserve?.status === 'lifted' && state === 'checked' && gone,
      `verdict=${JSON.stringify(r)} reserve.status=${reserve?.status} watchlist=${state} detectorAbsent=${gone}`)
  }

  console.log('\n── R2 Réserve Sans objet pour cette visite — ne touche pas la source, réapparaît à N+1')
  {
    const { id: reserveId } = await createSiteReserve({
      siteId, label: 'Recette R2', location: 'Zone test', issuedBy: 'Recette', issuedOn: pastDate(10), userId, organizationId: orgId,
    })
    manifest.reserveIds.push(reserveId)
    const itemId = await wl('Recette R2', 'reserve_open', reserveId)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'reserve_open', sourceRef: reserveId, verdict: 'sans_objet_visite', actorId: userId })
    const { data: reserve } = await db.from('site_reserve').select('status').eq('id', reserveId).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectOpenReserves(siteId)
    const stillPresent = signal?.items.some((i) => i.id === reserveId) ?? false
    record('R2 Sans objet pour cette visite', r.ok === true && reserve?.status === 'open' && state === 'not_applicable_visit' && stillPresent,
      `verdict=${JSON.stringify(r)} reserve.status=${reserve?.status} (inchangé attendu) watchlist=${state} detectorPresent=${stillPresent} (attendu true — reproposable N+1)`)
  }

  // ---------- O. Obligation ----------
  console.log('\n── O1 Obligation Satisfaite → satisfaite')
  {
    const { data: ob, error: obErr } = await db
      .from('site_obligation')
      .insert({
        site_id: siteId, organization_id: orgId, template_id: null, label: 'Recette O1',
        status: 'a_produire', verification_kind: 'document', verification_param: { neglect_days: 0 }, created_by: userId,
      })
      .select('id')
      .single()
    if (obErr || !ob) throw new Error(`Création O1: ${obErr?.message}`)
    manifest.obligationIds.push(ob.id)
    const itemId = await wl('Recette O1', 'obligation_neglected', ob.id)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'obligation_neglected', sourceRef: ob.id, verdict: 'positif', actorId: userId })
    const { data: obAfter } = await db.from('site_obligation').select('status').eq('id', ob.id).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectNeglectedObligations(siteId)
    const gone = !(signal?.items.some((i) => i.id === ob.id) ?? false)
    record('O1 Satisfaite', r.ok === true && obAfter?.status === 'satisfaite' && state === 'checked' && gone,
      `verdict=${JSON.stringify(r)} obligation.status=${obAfter?.status} watchlist=${state} detectorAbsent=${gone}`)
  }

  console.log('\n── O2 Obligation Ne plus suivre → non_applicable')
  {
    const { data: ob, error: obErr } = await db
      .from('site_obligation')
      .insert({
        site_id: siteId, organization_id: orgId, template_id: null, label: 'Recette O2',
        status: 'a_produire', verification_kind: 'document', verification_param: { neglect_days: 0 }, created_by: userId,
      })
      .select('id')
      .single()
    if (obErr || !ob) throw new Error(`Création O2: ${obErr?.message}`)
    manifest.obligationIds.push(ob.id)
    const itemId = await wl('Recette O2', 'obligation_neglected', ob.id)
    const r = await applyVerdictNoAuth({ watchlistItemId: itemId, reportId, siteId, sourceKind: 'obligation_neglected', sourceRef: ob.id, verdict: 'ne_plus_suivre', actorId: userId })
    const { data: obAfter } = await db.from('site_obligation').select('status').eq('id', ob.id).maybeSingle()
    const state = await getWatchlistState(db, itemId)
    const signal = await detectNeglectedObligations(siteId)
    const gone = !(signal?.items.some((i) => i.id === ob.id) ?? false)
    record('O2 Ne plus suivre', r.ok === true && obAfter?.status === 'non_applicable' && state === 'dismissed_permanently' && gone,
      `verdict=${JSON.stringify(r)} obligation.status=${obAfter?.status} watchlist=${state} detectorAbsent=${gone}`)
  }

  // ---------- PW. Proof window ----------
  console.log('\n── PW1/PW2 Proof window — aucune mutation métier, quel que soit le verdict')
  {
    const fakeSourceRef = randomUUID()
    const itemId1 = await wl('Recette PW1', 'proof_window_closing', fakeSourceRef)
    const r1 = await applyVerdictNoAuth({ watchlistItemId: itemId1, reportId, siteId, sourceKind: 'proof_window_closing', sourceRef: fakeSourceRef, verdict: 'positif', actorId: userId })
    const state1 = await getWatchlistState(db, itemId1)
    record('PW1 Photographié (constat)', r1.ok === true && state1 === 'checked', `verdict=${JSON.stringify(r1)} watchlist=${state1}`)

    const itemId2 = await wl('Recette PW2', 'proof_window_closing', fakeSourceRef)
    const r2 = await applyVerdictNoAuth({ watchlistItemId: itemId2, reportId, siteId, sourceKind: 'proof_window_closing', sourceRef: fakeSourceRef, verdict: 'negatif', actorId: userId })
    const state2 = await getWatchlistState(db, itemId2)
    record('PW2 Pas encore (constat)', r2.ok === true && state2 === 'still_open', `verdict=${JSON.stringify(r2)} watchlist=${state2}`)
  }

  // ---------- Nettoyage ----------
  console.log('\n── Nettoyage des témoins synthétiques')
  const reset = await resetSandboxSite(siteId, orgId)
  console.log(`   resetSandboxSite: ${JSON.stringify(reset)}`)
  for (const id of manifest.decisionIds) {
    await deleteSiteDecision(siteId, id)
  }
  for (const id of manifest.obligationIds) {
    await db.from('site_obligation').delete().eq('id', id)
  }
  console.log(`   décisions supprimées: ${manifest.decisionIds.length}, obligations supprimées: ${manifest.obligationIds.length}`)

  mkdirSync(join(process.cwd(), '.recette-runs'), { recursive: true })
  const manifestPath = join(process.cwd(), '.recette-runs', `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  const failures = results.filter((r) => !r.pass)
  console.log(`\n── Bilan : ${results.length - failures.length}/${results.length} PASS`)
  if (failures.length > 0) {
    console.log('   Échecs :')
    for (const f of failures) console.log(`   - ${f.scenario}: ${f.detail}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
