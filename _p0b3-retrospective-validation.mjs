// P0-B.3 — Validation rétrospective READ-ONLY après repli businessDate 3 niveaux.
// Aucune écriture, aucun appel RPC. Objectif (arbitrage Vincent 2026-09-17) :
// pour chaque groupe DEJA fusionné (Centre commercial Dumbéa Mall = 7,
// Hyper Dumbéa Mall = 72), reconstruire l'état pré-fusion à partir des données
// encore présentes (jamais de DELETE ; l'événement `cancelled` de mig 413
// enregistre before_value.status = statut du perdant AVANT annulation) et
// rejouer le moteur ACTUEL (started_at -> documents.effective_date ->
// created_at) dessus. Comparaison SAME_PLAN / PLAN_CHANGED avec le plan
// réellement exécuté (recoverable depuis l'état courant car patch=={} par
// construction pour ces 79 groupes AUTO_SAFE : la durable n'a jamais été
// modifiée par fn_apply_action_cbo_merge, cf. mig 413 §"if p_patch <> '{}'").
//
// Bella Napoli : pas encore backfillée -> dry-run simple avec le moteur actuel
// (pas de counterfactual, rien à comparer).
//
// Groupe 64 (CBO 9bb29408-ea00-438b-aca7-635af28f7180, Hyper Dumbéa Mall) :
// gelé par décision explicite de Vincent, reste NEEDS_HUMAN/hors périmètre
// même si le moteur actuel le classerait AUTO_SAFE — rappelé en sortie, jamais
// inclus dans le lot des 72 déjà exécutés (il fait partie des 4 AMBIGUOUS
// jamais traités).

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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

function tierDistribution(actions, businessDateOf) {
  const dist = { started_at: 0, effective_date: 0, created_at: 0 }
  for (const a of actions) dist[businessDateOf(a).tier] += 1
  return dist
}

async function loadSiteFull(siteNameExact) {
  const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name, phase').eq('name', siteNameExact)
  if (sitesErr) throw sitesErr
  if (sites.length !== 1) throw new Error(`Site "${siteNameExact}" : ${sites.length} résultat(s) exact(s)`)
  const site = sites[0]

  const { data: actions, error: actionsErr } = await supabase
    .from('site_actions')
    .select('id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
    .eq('site_id', site.id)
  if (actionsErr) throw actionsErr
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
    const { data, error } = await supabase.from('site_reports').select('id, started_at, title, created_at, source_document_id').in('id', idsChunk)
    if (error) throw error
    for (const r of data) reportById.set(r.id, r)
  }
  const documentIds = [...new Set([...reportById.values()].map((r) => r.source_document_id).filter(Boolean))]
  const documentById = new Map()
  for (const idsChunk of chunk(documentIds, 150)) {
    const { data, error } = await supabase.from('documents').select('id, effective_date').in('id', idsChunk)
    if (error) throw error
    for (const d of data) documentById.set(d.id, d)
  }

  const eventRows = []
  for (const idsChunk of chunk(actionIds, 150)) {
    if (idsChunk.length === 0) continue
    const { data, error } = await supabase
      .from('site_action_events').select('action_id, kind, before_value, after_value')
      .in('action_id', idsChunk).in('kind', ['unassigned', 'due_date_changed', 'cancelled'])
    if (error) throw error
    eventRows.push(...data)
  }
  const contactCleared = new Set(), companyCleared = new Set(), dueDateCleared = new Set()
  const cancelEventsByAction = new Map()
  for (const e of eventRows) {
    if (e.kind === 'unassigned') {
      if (e.before_value && 'contact_id' in e.before_value) contactCleared.add(e.action_id)
      if (e.before_value && 'company_id' in e.before_value) companyCleared.add(e.action_id)
    } else if (e.kind === 'due_date_changed' && e.after_value && e.after_value.date == null) {
      dueDateCleared.add(e.action_id)
    } else if (e.kind === 'cancelled') {
      const list = cancelEventsByAction.get(e.action_id) ?? []
      list.push(e)
      cancelEventsByAction.set(e.action_id, list)
    }
  }

  function businessDateOf(a) {
    const report = a.report_id ? reportById.get(a.report_id) : undefined
    const document = report?.source_document_id ? documentById.get(report.source_document_id) : undefined
    const businessDate = report?.started_at ?? document?.effective_date ?? a.created_at
    const tier = report?.started_at ? 'started_at' : document?.effective_date ? 'effective_date' : 'created_at'
    return { businessDate, tier }
  }

  function toCandidateCurrent(a) {
    const { businessDate } = businessDateOf(a)
    return {
      id: a.id, reportId: a.report_id, businessDate, status: a.status, supersededBy: a.superseded_by,
      title: a.title, assignedTo: a.assigned_to, assignedContactId: a.assigned_contact_id, assignedCompanyId: a.assigned_company_id,
      dueDate: a.due_date, dueDateStatus: a.due_date_status, reserveId: a.reserve_id, doneAt: a.done_at,
      completedComment: a.completed_comment, completedPhotoPath: a.completed_photo_path,
      contactExplicitlyCleared: contactCleared.has(a.id), companyExplicitlyCleared: companyCleared.has(a.id),
      dueDateExplicitlyCleared: dueDateCleared.has(a.id),
    }
  }

  // Reconstruction pré-fusion : mig 413 ne modifie QUE status/superseded_by/superseded_at
  // sur les perdants (aucun autre champ touché) et ne touche JAMAIS la durable quand
  // p_patch = {} (nos 79 groupes AUTO_SAFE). L'événement `cancelled` conserve
  // before_value.status = statut réel avant l'annulation.
  function reconstructPreMerge(a) {
    const cur = toCandidateCurrent(a)
    if (!(a.status === 'cancelled' && a.superseded_by !== null)) return cur
    const events = (cancelEventsByAction.get(a.id) ?? []).filter((e) => e.after_value?.superseded_by === a.superseded_by)
    if (events.length !== 1) return { ...cur, status: 'cancelled', supersededBy: null, reconstructionAnomaly: `${events.length} événement(s)` }
    const originalStatus = events[0].before_value?.status
    return { ...cur, status: originalStatus ?? a.status, supersededBy: null }
  }

  const byCbo = new Map()
  for (const m of members) {
    const list = byCbo.get(m.canonical_business_object_id) ?? []
    list.push(m.member_entity_id)
    byCbo.set(m.canonical_business_object_id, list)
  }
  const actionById = new Map(actions.map((a) => [a.id, a]))
  const groups = []
  for (const [cboId, ids] of byCbo.entries()) {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length <= 1) continue
    const rawActions = uniqueIds.map((id) => actionById.get(id)).filter(Boolean)
    groups.push({ cboId, rawActions })
  }

  return { site, actions, groups, businessDateOf, reconstructPreMerge }
}

function toCandidatePlain(a, businessDateOf) {
  const { businessDate } = businessDateOf(a)
  return {
    id: a.id, reportId: a.report_id, businessDate, status: a.status, supersededBy: a.superseded_by,
    title: a.title, assignedTo: a.assigned_to, assignedContactId: a.assigned_contact_id,
    assignedCompanyId: a.assigned_company_id, dueDate: a.due_date, dueDateStatus: a.due_date_status,
    reserveId: a.reserve_id, doneAt: a.done_at, completedComment: a.completed_comment,
    completedPhotoPath: a.completed_photo_path,
    contactExplicitlyCleared: false, companyExplicitlyCleared: false, dueDateExplicitlyCleared: false,
  }
}

async function retrospectiveForSite(siteNameExact, frozenCboIds) {
  console.log(`\n${'='.repeat(90)}\nSITE (déjà backfillé) = ${siteNameExact}\n${'='.repeat(90)}`)
  const state = await loadSiteFull(siteNameExact)
  const { site, actions, groups, businessDateOf, reconstructPreMerge } = state
  console.log(`site_id=${site.id} · ${actions.length} action(s) · ${groups.length} groupe(s) multi-membres`)

  const dist = tierDistribution(actions, businessDateOf)
  console.log(`Répartition businessDate (toutes actions du site) : started_at=${dist.started_at} · effective_date=${dist.effective_date} · created_at=${dist.created_at}`)

  let sameCount = 0, changedCount = 0, notYetExecuted = 0, anomalyCount = 0, frozenSkipped = 0, totalLosers = 0
  const sizeDist = new Map()
  const changedDetails = []

  for (const g of groups) {
    if (frozenCboIds.includes(g.cboId)) { frozenSkipped += 1; continue }
    const cancelledWithSupersede = g.rawActions.filter((a) => a.status === 'cancelled' && a.superseded_by !== null)
    const notCancelled = g.rawActions.filter((a) => !(a.status === 'cancelled' && a.superseded_by !== null))
    if (cancelledWithSupersede.length === 0) { notYetExecuted += 1; continue }
    if (notCancelled.length !== 1) {
      anomalyCount += 1
      console.log(`  ANOMALIE CBO ${g.cboId} : ${notCancelled.length} membre(s) actif(s) restant(s) (attendu 1).`)
      continue
    }
    const actualDurableId = notCancelled[0].id
    const actualLoserIds = cancelledWithSupersede.map((a) => a.id).sort()
    if (!cancelledWithSupersede.every((a) => a.superseded_by === actualDurableId)) {
      anomalyCount += 1
      console.log(`  ANOMALIE CBO ${g.cboId} : perdants pointant vers des durables différentes.`)
      continue
    }
    totalLosers += actualLoserIds.length
    sizeDist.set(g.rawActions.length, (sizeDist.get(g.rawActions.length) ?? 0) + 1)

    const reconstructed = g.rawActions.map(reconstructPreMerge)
    const newOutcome = planActionCboReconciliation(reconstructed)
    const newClassification = classify(newOutcome)

    let same = false, reason = ''
    if (newOutcome.kind !== 'merge') {
      reason = `nouveau kind=${newOutcome.kind} (classification=${newClassification}) au lieu de merge/AUTO_SAFE`
    } else {
      const newLoserIds = [...newOutcome.loserIds].sort()
      const sameDurable = newOutcome.durableId === actualDurableId
      const sameLosers = JSON.stringify(newLoserIds) === JSON.stringify(actualLoserIds)
      const samePatch = Object.keys(newOutcome.patch).length === 0
      same = sameDurable && sameLosers && samePatch
      if (!same) {
        const parts = []
        if (!sameDurable) parts.push(`durable ${actualDurableId} → ${newOutcome.durableId}`)
        if (!sameLosers) parts.push(`losers [${actualLoserIds.join(',')}] → [${newLoserIds.join(',')}]`)
        if (!samePatch) parts.push(`patch vide → ${JSON.stringify(newOutcome.patch)}`)
        reason = parts.join(' ; ')
      }
    }
    if (same) sameCount += 1
    else {
      changedCount += 1
      changedDetails.push({ cboId: g.cboId, actualDurableId, actualLoserIds, newOutcome, newClassification, reason, members: g.rawActions.length })
    }
  }

  console.log(`\nGroupes déjà fusionnés analysés = ${sameCount + changedCount} (gelés exclus=${frozenSkipped}, pas encore exécutés=${notYetExecuted}, anomalies=${anomalyCount})`)
  console.log(`  SAME_PLAN    = ${sameCount}`)
  console.log(`  PLAN_CHANGED = ${changedCount}`)
  console.log(`Volume : ${totalLosers} action(s) superseded. Distribution taille groupe (membres→nb groupes) : ${[...sizeDist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}→${v}`).join(', ') || '(aucun)'}`)

  if (changedDetails.length > 0) {
    console.log(`\n--- DÉTAIL PLAN_CHANGED (${changedDetails.length}) ---`)
    for (const d of changedDetails) {
      console.log(`CBO ${d.cboId} (${d.members} membres) : ${d.reason} — nouvelle classification=${d.newClassification}`)
    }
  }
  return { site, sameCount, changedCount, notYetExecuted, anomalyCount, changedDetails }
}

async function dryrunOnly(siteNameExact) {
  console.log(`\n${'='.repeat(90)}\nSITE (pas encore backfillé) = ${siteNameExact} — DRY-RUN 3-TIER SEULEMENT\n${'='.repeat(90)}`)
  const state = await loadSiteFull(siteNameExact)
  const { site, actions, groups, businessDateOf } = state
  const dist = tierDistribution(actions, businessDateOf)
  console.log(`site_id=${site.id} · ${actions.length} action(s) · ${groups.length} groupe(s) multi-membres`)
  console.log(`Répartition businessDate : started_at=${dist.started_at} · effective_date=${dist.effective_date} · created_at=${dist.created_at}`)
  const counts = { AUTO_SAFE: 0, AMBIGUOUS: 0, NEEDS_HUMAN: 0, NONE: 0 }
  for (const g of groups) {
    const candidates = g.rawActions.map((a) => toCandidatePlain(a, businessDateOf))
    const outcome = planActionCboReconciliation(candidates)
    const cls = classify(outcome)
    counts[cls] = (counts[cls] ?? 0) + 1
    if (cls !== 'NONE') console.log(`  CBO ${g.cboId} (${g.rawActions.length} membres) → ${cls}`)
  }
  console.log(`TOTAL : AUTO_SAFE=${counts.AUTO_SAFE} AMBIGUOUS=${counts.AMBIGUOUS} NEEDS_HUMAN=${counts.NEEDS_HUMAN} NONE=${counts.NONE}`)
}

async function main() {
  const results = []
  // 1) Centre commercial Dumbéa Mall — 7 groupes AUTO_SAFE déjà fusionnés (moteur 2 niveaux).
  results.push(await retrospectiveForSite('Centre commercial Dumbéa Mall', []))
  // 2) Hyper Dumbéa Mall — 72 groupes AUTO_SAFE déjà fusionnés, 4 AMBIGUOUS gelés (dont groupe 64).
  results.push(await retrospectiveForSite('Hyper Dumbéa Mall', [
    'a97740d9-e9d6-44ba-8dd0-6937a0dd49df',
    'ce6a73c0-c39e-4f8c-bd29-abd45cea8c15',
    'a0212486-f980-4e6d-ba3c-55bcf881d60b',
    '9bb29408-ea00-438b-aca7-635af28f7180',
  ]))
  // 3) Bella Napoli — pas encore backfillée : dry-run simple, pas de counterfactual.
  await dryrunOnly('Bella Napoli')

  const totalSame = results.reduce((s, r) => s + r.sameCount, 0)
  const totalChanged = results.reduce((s, r) => s + r.changedCount, 0)
  console.log(`\n${'='.repeat(90)}\nVERDICT GLOBAL (Centre commercial Dumbéa Mall + Hyper Dumbéa Mall)\n${'='.repeat(90)}`)
  console.log(`SAME_PLAN total = ${totalSame} · PLAN_CHANGED total = ${totalChanged}`)
  console.log(totalChanged === 0 ? 'ALL_EXECUTED_MERGES_STILL_SAFE' : `REPAIR_REQUIRED — ${totalChanged} groupe(s) à examiner (voir DÉTAIL PLAN_CHANGED ci-dessus)`)

  console.log('\nAUCUNE ÉCRITURE — script lecture seule (P0-B.3).')
}

await main()
