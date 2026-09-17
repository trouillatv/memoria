// P0-B.4 DATA REPAIR — Hyper Dumbéa Mall uniquement (GO Vincent 2026-09-17).
//
// Répare les durables dont le body est vide alors qu'un loser supersedé du même
// CBO portait un contenu récupérable — perte induite par les scripts .mjs de la
// campagne P0-B (jamais par le moteur de production, cf. HARD STOP P0-B.4).
//
// Méthode : reconstruction READ-ONLY de l'état pré-fusion de CHAQUE groupe
// (mêmes garanties qu'en P0-B.3 : mig 413 ne modifie que status/superseded_by/
// superseded_at des perdants, before_value.status de l'événement `cancelled`
// donne le statut exact avant annulation), puis rejeu du moteur de production
// actuel (planActionCboReconciliation, body/title inclus — mirror exact de
// lib/db/action-cbo-reconciliation.ts) sur cet état. Le patch.body obtenu est
// EXACTEMENT celui que le moteur aurait produit si les scripts avaient chargé
// body correctement. Aucun choix arbitraire (ni "plus récent", ni "plus long").
//
// Deux modes :
//   node _p0b4-repair-body.mjs           → PLAN seul, aucune écriture.
//   node _p0b4-repair-body.mjs --apply   → applique via fn_update_action
//                                           (RPC déjà utilisée par updateSiteAction,
//                                           UNIQUEMENT après validation stricte de
//                                           chacun des 25 cas).
//
// Garde-fous avant toute écriture, par groupe :
//   - patch recalculé ne contient QUE la clé body (aucun autre champ).
//   - durable.body courant (avant écriture) est vide.
//   - patch.body non vide.
//   - durable/loser/superseded_by/CBO membership inchangés (on ne les touche pas).

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const APPLY = process.argv.includes('--apply')
const FROZEN_CBO_IDS = [
  'a97740d9-e9d6-44ba-8dd0-6937a0dd49df',
  'ce6a73c0-c39e-4f8c-bd29-abd45cea8c15',
  'a0212486-f980-4e6d-ba3c-55bcf881d60b',
  '9bb29408-ea00-438b-aca7-635af28f7180', // groupe 64, gelé — jamais touché
]

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

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name').eq('name', 'Hyper Dumbéa Mall')
if (sitesErr) throw sitesErr
if (sites.length !== 1) throw new Error(`Site Hyper Dumbéa Mall : ${sites.length} résultat(s) exact(s)`)
const site = sites[0]

const { data: actions, error: actionsErr } = await supabase
  .from('site_actions')
  .select('id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
  .eq('site_id', site.id)
if (actionsErr) throw actionsErr
const actionById = new Map(actions.map((a) => [a.id, a]))
const actionIds = actions.map((a) => a.id)

const members = []
for (const idsChunk of chunk(actionIds, 150)) {
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
  return businessDate
}

function toCandidateCurrent(a) {
  return {
    id: a.id, reportId: a.report_id, businessDate: businessDateOf(a), status: a.status, supersededBy: a.superseded_by,
    title: a.title, body: a.body, assignedTo: a.assigned_to, assignedContactId: a.assigned_contact_id, assignedCompanyId: a.assigned_company_id,
    dueDate: a.due_date, dueDateStatus: a.due_date_status, reserveId: a.reserve_id, doneAt: a.done_at,
    completedComment: a.completed_comment, completedPhotoPath: a.completed_photo_path,
    contactExplicitlyCleared: contactCleared.has(a.id), companyExplicitlyCleared: companyCleared.has(a.id),
    dueDateExplicitlyCleared: dueDateCleared.has(a.id),
  }
}

// Reconstruction pré-fusion, body/title inclus cette fois (fix de l'omission des
// scripts .mjs de campagne — cf. HARD STOP P0-B.4).
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

const repairPlan = []
const rejected = []

for (const [cboId, ids] of byCbo.entries()) {
  if (FROZEN_CBO_IDS.includes(cboId)) continue
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length <= 1) continue
  const rawActions = uniqueIds.map((id) => actionById.get(id)).filter(Boolean)
  const cancelledWithSupersede = rawActions.filter((a) => a.status === 'cancelled' && a.superseded_by !== null)
  const notCancelled = rawActions.filter((a) => !(a.status === 'cancelled' && a.superseded_by !== null))
  if (cancelledWithSupersede.length === 0) continue // pas encore exécuté
  if (notCancelled.length !== 1) continue // anomalie hors périmètre, déjà couvert par P0-B.3 (0 anomalie)
  const actualDurableId = notCancelled[0].id
  const actualLoserIds = cancelledWithSupersede.map((a) => a.id).sort()
  if (!cancelledWithSupersede.every((a) => a.superseded_by === actualDurableId)) continue

  const currentDurable = actionById.get(actualDurableId)
  const durableBodyEmptyNow = currentDurable.body === null || currentDurable.body === undefined || String(currentDurable.body).trim() === ''
  if (!durableBodyEmptyNow) continue // rien à réparer sur ce groupe

  const reconstructed = rawActions.map(reconstructPreMerge)
  const outcome = planActionCboReconciliation(reconstructed)

  if (outcome.kind !== 'merge') {
    rejected.push({ cboId, actualDurableId, reason: `outcome.kind=${outcome.kind} (attendu merge)` })
    continue
  }
  const newLoserIds = [...outcome.loserIds].sort()
  const sameDurable = outcome.durableId === actualDurableId
  const sameLosers = JSON.stringify(newLoserIds) === JSON.stringify(actualLoserIds)
  if (!sameDurable || !sameLosers) {
    rejected.push({ cboId, actualDurableId, reason: `durable/losers divergent (durable ${outcome.durableId}, losers ${newLoserIds.join(',')})` })
    continue
  }
  const patchKeys = Object.keys(outcome.patch)
  if (patchKeys.length !== 1 || patchKeys[0] !== 'body') {
    rejected.push({ cboId, actualDurableId, reason: `patch contient autre chose que body seul : ${JSON.stringify(outcome.patch)}` })
    continue
  }
  if (!outcome.patch.body || String(outcome.patch.body).trim() === '') {
    rejected.push({ cboId, actualDurableId, reason: 'patch.body vide/absent — rien à absorber malgré durable.body vide' })
    continue
  }

  const sourceCandidate = reconstructed
    .filter((c) => c.status !== 'cancelled' && c.supersededBy === null && c.id !== actualDurableId)
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
    .find((c) => c.body === outcome.patch.body)

  repairPlan.push({
    cboId,
    durableId: actualDurableId,
    loserIds: actualLoserIds,
    bodyBefore: currentDurable.body,
    bodyAfter: outcome.patch.body,
    sourceLoserId: sourceCandidate?.id ?? '(non identifié)',
    sourceReportId: sourceCandidate?.reportId ?? null,
  })
}

console.log(`Site = ${site.name} [${site.id}]`)
console.log(`Candidats de réparation déterministes = ${repairPlan.length}`)
console.log(`Rejetés (non déterministe / patch inattendu) = ${rejected.length}`)

for (const r of rejected) console.log(`  REJETÉ CBO ${r.cboId} durable=${r.actualDurableId} : ${r.reason}`)

console.log('\n--- PLAN DE RÉPARATION ---')
for (const p of repairPlan) {
  console.log(`\nCBO ${p.cboId}`)
  console.log(`  durable=${p.durableId}  losers=[${p.loserIds.join(',')}]`)
  console.log(`  body AVANT = ${JSON.stringify(p.bodyBefore)}`)
  console.log(`  body APRÈS (patch déterministe du moteur) = "${p.bodyAfter}"`)
  console.log(`  source = loser ${p.sourceLoserId} (report_id=${p.sourceReportId})`)
}

if (!APPLY) {
  console.log(`\nMODE PLAN — aucune écriture. Relancer avec --apply pour exécuter les ${repairPlan.length} réparations ci-dessus.`)
  process.exit(0)
}

console.log(`\n=== APPLICATION — ${repairPlan.length} écriture(s) via fn_update_action (body uniquement) ===`)
let okCount = 0
for (const p of repairPlan) {
  const { data, error } = await supabase.rpc('fn_update_action', {
    p_id: p.durableId,
    p_patch: { body: p.bodyAfter },
    p_actor_id: null,
  })
  if (error) {
    console.log(`  ERREUR durable=${p.durableId} : ${error.message}`)
    continue
  }
  okCount += 1
  console.log(`  OK durable=${p.durableId} (site_id retourné=${data})`)
}
console.log(`\n${okCount}/${repairPlan.length} réparations appliquées.`)
