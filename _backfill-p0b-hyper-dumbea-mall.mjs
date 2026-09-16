// P0-B/P0-C — BACKFILL réel, périmètre STRICT Hyper Dumbéa Mall, 72 GROUPES
// AUTO_SAFE UNIQUEMENT. GO Vincent 2026-09-17, après dry-run classify (76
// groupes : 72 AUTO_SAFE / 4 AMBIGUOUS / 0 NEEDS_HUMAN).
//
// Décision Vincent : les 4 AMBIGUOUS restent STRICTEMENT intouchés dans cette
// campagne (reclassés en pratique comme NEEDS_HUMAN — pas d'absorption
// automatique d'assignedCompanyId, y compris le groupe 64 jugé "probablement
// fusionnable"). Aucune exception, aucun traitement partiel : seuls les
// groupes classés AUTO_SAFE (patch vide) sont exécutés.
//
// Utilise ENCORE le moteur de date à 2 niveaux (started_at → created_at) —
// conforme à la décision Vincent : les 72 AUTO_SAFE sont déjà classifiés sans
// ambiguïté avec ce moteur, le fallback à 3 niveaux (documents.effective_date)
// n'est requis qu'AVANT la prochaine campagne de fusion, pas pour ce lot.
//
// Miroir exact de planActionCboReconciliation (lib/db/action-cbo-reconciliation.ts,
// AVANT le repli 3 niveaux). Appelle le vrai RPC fn_apply_action_cbo_merge via
// PostgREST (sb.rpc).
//
// Garde-fous : abandon SANS AUCUNE écriture si le site résolu n'est pas
// exactement "Hyper Dumbéa Mall", si le total de groupes multi-membres actifs
// n'est pas exactement 76, si AUTO_SAFE != 72, AMBIGUOUS != 4 ou NEEDS_HUMAN != 0.
// Exécution limitée aux seuls groupes AUTO_SAFE.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const SITE_NAME_EXACT = 'Hyper Dumbéa Mall'

function planActionCboReconciliation(actions) {
  const active = actions.filter((a) => a.status !== 'cancelled' && a.supersededBy === null)
  if (active.length <= 1) return { kind: 'none' }

  const sorted = [...active].sort(
    (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
  )
  const [durable, ...others] = sorted
  const latest = sorted[sorted.length - 1]
  const pendingIds = others.map((a) => a.id)

  const doneCount = sorted.filter((a) => a.status === 'done').length
  const reopenedAfterDone = latest.status !== 'done' && sorted.slice(0, -1).some((a) => a.status === 'done')
  if (reopenedAfterDone) {
    return { kind: 'blocked_done_durable', reason: 'reopened_after_done', durableId: durable.id, pendingActiveIds: pendingIds }
  }
  if (doneCount >= 2) {
    return { kind: 'blocked_done_durable', reason: 'multiple_done_occurrences', durableId: durable.id, pendingActiveIds: pendingIds }
  }

  const patch = {}
  if (latest.status !== durable.status) {
    patch.status = latest.status
    if (latest.status === 'done') {
      if (latest.doneAt) patch.doneAt = latest.doneAt
      if (latest.completedComment) patch.completedComment = latest.completedComment
      if (latest.completedPhotoPath) patch.completedPhotoPath = latest.completedPhotoPath
    }
  }
  if (!durable.title) { const s = others.find((o) => o.title); if (s?.title) patch.title = s.title }
  if (!durable.body) { const s = others.find((o) => o.body); if (s?.body) patch.body = s.body }
  if (!durable.assignedTo) { const s = others.find((o) => o.assignedTo); if (s?.assignedTo) patch.assignedTo = s.assignedTo }
  if (!durable.reserveId) { const s = others.find((o) => o.reserveId); if (s?.reserveId) patch.reserveId = s.reserveId }
  if (!durable.assignedCompanyId && !durable.companyExplicitlyCleared) {
    const s = others.find((o) => o.assignedCompanyId)
    if (s?.assignedCompanyId) patch.assignedCompanyId = s.assignedCompanyId
  }
  if (!durable.assignedContactId && !durable.contactExplicitlyCleared) {
    const s = others.find((o) => o.assignedContactId)
    if (s?.assignedContactId) patch.assignedContactId = s.assignedContactId
  }
  if (!durable.dueDate && !durable.dueDateExplicitlyCleared) {
    const s = others.find((o) => o.dueDate)
    if (s?.dueDate) { patch.dueDate = s.dueDate; if (s.dueDateStatus) patch.dueDateStatus = s.dueDateStatus }
  }
  return { kind: 'merge', durableId: durable.id, loserIds: pendingIds, patch }
}

function classify(outcome) {
  if (outcome.kind === 'none') return 'NONE'
  if (outcome.kind === 'blocked_done_durable') return 'NEEDS_HUMAN'
  if (outcome.kind === 'merge') return Object.keys(outcome.patch).length === 0 ? 'AUTO_SAFE' : 'AMBIGUOUS'
  return 'UNKNOWN'
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function loadState(site) {
  const { data: actions, error: actionsErr } = await supabase
    .from('site_actions')
    .select('id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
    .eq('site_id', site.id)
  if (actionsErr) throw actionsErr
  const actionById = new Map(actions.map((a) => [a.id, a]))
  const actionIds = actions.map((a) => a.id)

  const members = []
  for (const idsChunk of chunk(actionIds, 150)) {
    if (idsChunk.length === 0) continue
    const { data, error } = await supabase
      .from('canonical_business_object_member')
      .select('canonical_business_object_id, member_entity_id')
      .eq('member_entity_type', 'site_action')
      .in('member_entity_id', idsChunk)
    if (error) throw error
    members.push(...data)
  }

  const reportIds = [...new Set(actions.map((a) => a.report_id).filter(Boolean))]
  const reportById = new Map()
  for (const idsChunk of chunk(reportIds, 150)) {
    const { data, error } = await supabase.from('site_reports').select('id, started_at, title, created_at').in('id', idsChunk)
    if (error) throw error
    for (const r of data) reportById.set(r.id, r)
  }

  const eventRows = []
  for (const idsChunk of chunk(actionIds, 150)) {
    if (idsChunk.length === 0) continue
    const { data, error } = await supabase
      .from('site_action_events')
      .select('action_id, kind, before_value, after_value')
      .in('action_id', idsChunk)
      .in('kind', ['unassigned', 'due_date_changed'])
    if (error) throw error
    eventRows.push(...data)
  }
  const contactCleared = new Set(), companyCleared = new Set(), dueDateCleared = new Set()
  for (const e of eventRows) {
    if (e.kind === 'unassigned') {
      if (e.before_value && 'contact_id' in e.before_value) contactCleared.add(e.action_id)
      if (e.before_value && 'company_id' in e.before_value) companyCleared.add(e.action_id)
    } else if (e.kind === 'due_date_changed' && e.after_value && e.after_value.date == null) {
      dueDateCleared.add(e.action_id)
    }
  }

  function toCandidate(a) {
    const report = a.report_id ? reportById.get(a.report_id) : undefined
    const businessDate = report?.started_at ?? a.created_at
    return {
      id: a.id, reportId: a.report_id, businessDate, status: a.status, supersededBy: a.superseded_by,
      title: a.title, assignedTo: a.assigned_to, assignedContactId: a.assigned_contact_id,
      assignedCompanyId: a.assigned_company_id, dueDate: a.due_date, dueDateStatus: a.due_date_status,
      reserveId: a.reserve_id, doneAt: a.done_at, completedComment: a.completed_comment,
      completedPhotoPath: a.completed_photo_path,
      contactExplicitlyCleared: contactCleared.has(a.id),
      companyExplicitlyCleared: companyCleared.has(a.id),
      dueDateExplicitlyCleared: dueDateCleared.has(a.id),
    }
  }

  const byCbo = new Map()
  for (const m of members) {
    const list = byCbo.get(m.canonical_business_object_id) ?? []
    list.push(m.member_entity_id)
    byCbo.set(m.canonical_business_object_id, list)
  }

  const groups = []
  for (const [cboId, ids] of byCbo.entries()) {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length <= 1) continue
    const candidates = uniqueIds.map((id) => actionById.get(id)).filter(Boolean).map(toCandidate)
    const outcome = planActionCboReconciliation(candidates)
    groups.push({ cboId, candidates, outcome, classification: classify(outcome) })
  }

  return { actions, actionById, members, reportById, groups }
}

// 1. Résoudre le site STRICTEMENT (nom exact, jamais le "Centre commercial").
const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name, phase').eq('name', SITE_NAME_EXACT)
if (sitesErr) throw sitesErr
if (sites.length !== 1) throw new Error(`Site "${SITE_NAME_EXACT}" : ${sites.length} résultat(s) exact(s) — ${JSON.stringify(sites)}`)
const site = sites[0]
console.log(`Site = ${site.name} [${site.id}] phase=${site.phase}`)

// 2. État AVANT.
const before = await loadState(site)
const autoSafeGroups = before.groups.filter((g) => g.classification === 'AUTO_SAFE')
const ambiguousGroups = before.groups.filter((g) => g.classification === 'AMBIGUOUS')
const needsHumanGroups = before.groups.filter((g) => g.classification === 'NEEDS_HUMAN')

console.log(`Groupes multi-membres = ${before.groups.length} · AUTO_SAFE=${autoSafeGroups.length} · AMBIGUOUS=${ambiguousGroups.length} · NEEDS_HUMAN=${needsHumanGroups.length}`)

// GARDE-FOU : abandon total si le périmètre ne correspond pas EXACTEMENT au GO.
if (before.groups.length !== 76) {
  throw new Error(`ABANDON — attendu exactement 76 groupes multi-membres, trouvé ${before.groups.length}. Aucune écriture effectuée.`)
}
if (autoSafeGroups.length !== 72) {
  throw new Error(`ABANDON — attendu exactement 72 groupes AUTO_SAFE, trouvé ${autoSafeGroups.length}. Aucune écriture effectuée.`)
}
if (ambiguousGroups.length !== 4) {
  throw new Error(`ABANDON — attendu exactement 4 groupes AMBIGUOUS, trouvé ${ambiguousGroups.length}. Aucune écriture effectuée.`)
}
if (needsHumanGroups.length !== 0) {
  throw new Error(`ABANDON — attendu 0 groupe NEEDS_HUMAN, trouvé ${needsHumanGroups.length}. Aucune écriture effectuée.`)
}
console.log('AMBIGUOUS gelés (non traités dans cette campagne) :', ambiguousGroups.map((g) => g.cboId).join(', '))

const totalActiveBefore = before.actions.filter((a) => a.status !== 'cancelled' && a.superseded_by === null).length
console.log(`Actions actives AVANT (tout le site) = ${totalActiveBefore}`)

// 3. Exécution réelle — UNIQUEMENT les groupes AUTO_SAFE. Un seul appel RPC
//    par groupe, patch vide confirmé. Les AMBIGUOUS ne sont JAMAIS soumis au RPC.
const results = []
for (const g of autoSafeGroups) {
  const { durableId, loserIds, patch } = g.outcome
  console.log(`\nGROUPE CBO ${g.cboId} — durable=${durableId} losers=${loserIds.join(',')} patch=${JSON.stringify(patch)}`)
  const { data, error } = await supabase.rpc('fn_apply_action_cbo_merge', {
    p_durable_id: durableId, p_loser_ids: loserIds, p_patch: patch, p_actor_id: null,
  })
  if (error) throw new Error(`RPC a échoué sur CBO ${g.cboId}: ${JSON.stringify(error)}`)
  console.log(`  → RPC OK, actionsSuperseded=${data}`)
  results.push({ cboId: g.cboId, durableId, loserIds, superseded: data })
}

// 4. État APRÈS.
const after = await loadState(site)
const totalActiveAfter = after.actions.filter((a) => a.status !== 'cancelled' && a.superseded_by === null).length
console.log(`\nActions actives APRÈS (tout le site) = ${totalActiveAfter} (delta = ${totalActiveAfter - totalActiveBefore})`)

// 5. Vérifications détaillées par groupe traité.
console.log('\n=== VÉRIFICATION PAR GROUPE TRAITÉ ===')
let membershipFailures = 0
for (const r of results) {
  const durableAfter = after.actionById.get(r.durableId)
  const losersAfter = r.loserIds.map((id) => after.actionById.get(id))
  const beforeMembers = before.members.filter((m) => m.canonical_business_object_id === r.cboId).map((m) => m.member_entity_id).sort()
  const afterMembers = after.members.filter((m) => m.canonical_business_object_id === r.cboId).map((m) => m.member_entity_id).sort()
  const membershipIntact = JSON.stringify(beforeMembers) === JSON.stringify(afterMembers)
  if (!membershipIntact) membershipFailures += 1
  if (durableAfter.status === 'cancelled' || durableAfter.superseded_by !== null || losersAfter.some((l) => l.status !== 'cancelled' || l.superseded_by !== r.durableId) || !membershipIntact) {
    console.log(`CBO ${r.cboId} : ANOMALIE — durable status=${durableAfter.status} superseded_by=${durableAfter.superseded_by} · losers=${JSON.stringify(losersAfter.map((l) => ({ id: l.id, status: l.status, superseded_by: l.superseded_by })))} · membership intact=${membershipIntact}`)
  }
}
console.log(`Groupes traités = ${results.length} · anomalies membership = ${membershipFailures}`)

// 6. Vérifier que les 4 AMBIGUOUS n'ont subi AUCUNE écriture.
let ambiguousUntouched = 0
for (const g of ambiguousGroups) {
  const afterGroup = after.groups.find((ag) => ag.cboId === g.cboId)
  const beforeIds = g.candidates.map((c) => c.id).sort()
  const afterIds = afterGroup ? afterGroup.candidates.map((c) => c.id).sort() : []
  const beforeStatuses = JSON.stringify(g.candidates.map((c) => ({ id: c.id, status: c.status, supersededBy: c.supersededBy })).sort((a, b) => a.id.localeCompare(b.id)))
  const afterStatuses = afterGroup ? JSON.stringify(afterGroup.candidates.map((c) => ({ id: c.id, status: c.status, supersededBy: c.supersededBy })).sort((a, b) => a.id.localeCompare(b.id))) : '[]'
  const untouched = JSON.stringify(beforeIds) === JSON.stringify(afterIds) && beforeStatuses === afterStatuses
  if (untouched) ambiguousUntouched += 1
  else console.log(`CBO ${g.cboId} (AMBIGUOUS) : CHANGEMENT INATTENDU DÉTECTÉ — avant=${beforeStatuses} après=${afterStatuses}`)
}
console.log(`AMBIGUOUS intouchés = ${ambiguousUntouched}/${ambiguousGroups.length} (attendu ${ambiguousGroups.length}/${ambiguousGroups.length})`)

// 7. Anomalies action_cbo_reconcile_error sur les rapports concernés.
const reportIds = [...new Set(before.actions.map((a) => a.report_id).filter(Boolean))]
const errRows = []
for (const idsChunk of chunk(reportIds, 150)) {
  const { data, error } = await supabase.from('site_reports').select('id, action_cbo_reconcile_error').in('id', idsChunk)
  if (error) throw error
  errRows.push(...data)
}
const anomalies = errRows.filter((r) => r.action_cbo_reconcile_error !== null)
console.log(`\naction_cbo_reconcile_error anomalies sur les rapports du site = ${anomalies.length}`)

// 8. Idempotence — re-calcule le plan sur l'état APRÈS pour les 72 groupes
//    traités : doit être 'none' partout (0 nouvel appel RPC). Les 4 AMBIGUOUS
//    doivent rester classés AMBIGUOUS (jamais devenus 'none' silencieusement).
const treatedIds = new Set(autoSafeGroups.map((g) => g.cboId))
const replanTreated = after.groups.filter((g) => treatedIds.has(g.cboId))
const stillActionable = replanTreated.filter((g) => g.outcome.kind !== 'none')
console.log(`\nIDEMPOTENCE — re-plan sur les 72 CBO traités : ${stillActionable.length} groupe(s) encore actionnable(s) (attendu 0).`)
if (stillActionable.length > 0) {
  console.log('  DÉTAIL (inattendu) :', JSON.stringify(stillActionable.map((g) => ({ cbo: g.cboId, outcome: g.outcome }))))
}
const replanAmbiguous = after.groups.filter((g) => ambiguousGroups.some((ag) => ag.cboId === g.cboId))
const ambiguousStillAmbiguous = replanAmbiguous.filter((g) => g.classification === 'AMBIGUOUS').length
console.log(`AMBIGUOUS toujours classés AMBIGUOUS après backfill = ${ambiguousStillAmbiguous}/${ambiguousGroups.length}`)

console.log('\n=== FIN BACKFILL HYPER DUMBÉA MALL (72 AUTO_SAFE) ===')
