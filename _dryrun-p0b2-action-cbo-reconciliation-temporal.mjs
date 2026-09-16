// P0-B.2 (sécurité temporelle, arbitrage Vincent 2026-09-17) — DRY-RUN
// TRANSVERSE, LECTURE SEULE. Aucune écriture, aucun appel RPC
// fn_apply_action_cbo_merge, aucune application de migration.
//
// Objectif : prouver sur des données réelles que planActionCboReconciliation
// (version P0-B.2, businessDate) donne EXACTEMENT le même résultat quel que
// soit l'ordre d'import des membres d'un groupe CBO — jamais un résultat
// dépendant de created_at ou de l'ordre du tableau.
//
// Miroir exact de lib/db/action-cbo-reconciliation.ts (copie volontaire,
// lecture seule isolée, aucune dépendance applicative) : businessDate =
// site_reports.started_at du rapport source (repli created_at), guard
// reopened_after_done (cas B), guard multiple_done_occurrences (cas E),
// protection contact/entreprise/échéance par événement avant_value.
//
// Périmètre : les 7 groupes Dumbéa Mall déjà connus (P0-B.1) + un échantillon
// des groupes transverses (tous chantiers phase='actif' + Dumbéa Mall/Hyper
// Dumbéa Mall/Bella Napoli/PETRO ATTITI).

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Miroir exact de planActionCboReconciliation (lib/db/action-cbo-reconciliation.ts, P0-B.2).
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

function outcomeEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// 1. Même périmètre que le dry-run P0-B.1 (comparabilité directe).
const { data: dumbeaCandidates, error: dumbeaErr } = await supabase
  .from('sites').select('id, name, phase').ilike('name', '%dumb%a mall%')
if (dumbeaErr) { console.error('ERREUR sites (dumbéa):', dumbeaErr); process.exit(1) }
const centreCommercialDumbea = dumbeaCandidates.find((s) => /centre commercial/i.test(s.name))
const hyperDumbea = dumbeaCandidates.find((s) => /hyper/i.test(s.name)) ?? { id: 'bebcdf12-fec0-44d8-858b-249ddea02db4', name: 'Hyper Dumbéa Mall (id connu, non retrouvé par nom)' }

const NAMED_SITE_IDS = [
  centreCommercialDumbea?.id,
  hyperDumbea?.id,
  'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6', // Bella Napoli
  '75bd3d23-d515-46bd-8de8-254495a5bade', // Lycée PETRO ATTITI
].filter(Boolean)

const { data: activeSites, error: activeErr } = await supabase
  .from('sites').select('id, name, phase').eq('phase', 'actif')
if (activeErr) { console.error('ERREUR sites (actif):', activeErr); process.exit(1) }

const siteById = new Map()
for (const s of [...dumbeaCandidates, ...activeSites]) siteById.set(s.id, s)
const scopeIds = [...new Set([...NAMED_SITE_IDS, ...activeSites.map((s) => s.id)])]

console.log(`=== PÉRIMÈTRE === ${scopeIds.length} chantier(s) (identique au dry-run P0-B.1).`)

// 2. Actions + rattachements CBO.
const { data: actions, error: actionsErr } = await supabase
  .from('site_actions')
  .select('id, site_id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
  .in('site_id', scopeIds)
if (actionsErr) { console.error('ERREUR site_actions:', actionsErr); process.exit(1) }
console.log(`\n${actions.length} action(s) au total sur le périmètre.`)

const actionIds = actions.map((a) => a.id)

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const members = []
for (const idsChunk of chunk(actionIds, 150)) {
  const { data, error } = await supabase
    .from('canonical_business_object_member')
    .select('canonical_business_object_id, member_entity_id')
    .eq('member_entity_type', 'site_action')
    .in('member_entity_id', idsChunk)
  if (error) { console.error('ERREUR canonical_business_object_member:', JSON.stringify(error)); process.exit(1) }
  members.push(...data)
}
console.log(`${members.length} rattachement(s) CBO trouvé(s) pour ces actions.`)

// 3. site_reports.started_at — la date métier réelle (P0-B.2).
const reportIds = [...new Set(actions.map((a) => a.report_id).filter(Boolean))]
const reportStartedAt = new Map()
for (const idsChunk of chunk(reportIds, 150)) {
  const { data, error } = await supabase.from('site_reports').select('id, started_at').in('id', idsChunk)
  if (error) { console.error('ERREUR site_reports:', JSON.stringify(error)); process.exit(1) }
  for (const r of data) if (r.started_at) reportStartedAt.set(r.id, r.started_at)
}
console.log(`${reportStartedAt.size}/${reportIds.length} rapport(s) source avec started_at renseigné.`)

// 4. Événements de protection humaine — before_value (P0-B.2 : correction du
// bug avant/après), distinction contact_id / company_id.
const eventRows = []
for (const idsChunk of chunk(actionIds, 150)) {
  const { data, error } = await supabase
    .from('site_action_events')
    .select('action_id, kind, before_value, after_value')
    .in('action_id', idsChunk)
    .in('kind', ['unassigned', 'due_date_changed'])
  if (error) { console.error('ERREUR site_action_events:', JSON.stringify(error)); process.exit(1) }
  eventRows.push(...data)
}
const contactCleared = new Set()
const companyCleared = new Set()
const dueDateCleared = new Set()
for (const e of eventRows) {
  if (e.kind === 'unassigned') {
    const before = e.before_value
    if (before && 'contact_id' in before) contactCleared.add(e.action_id)
    if (before && 'company_id' in before) companyCleared.add(e.action_id)
  } else if (e.kind === 'due_date_changed' && e.after_value && e.after_value.date == null) {
    dueDateCleared.add(e.action_id)
  }
}
console.log(`${contactCleared.size} action(s) avec retrait contact explicite. ${companyCleared.size} action(s) avec retrait entreprise explicite. ${dueDateCleared.size} action(s) avec échéance explicitement vidée.`)

const actionById = new Map(actions.map((a) => [a.id, a]))
function toCandidate(a) {
  const businessDate = (a.report_id ? reportStartedAt.get(a.report_id) : undefined) ?? a.created_at
  return {
    id: a.id,
    createdAt: a.created_at,
    businessDate,
    status: a.status,
    supersededBy: a.superseded_by,
    title: a.title,
    body: a.body,
    assignedTo: a.assigned_to,
    assignedContactId: a.assigned_contact_id,
    assignedCompanyId: a.assigned_company_id,
    dueDate: a.due_date,
    dueDateStatus: a.due_date_status,
    reserveId: a.reserve_id,
    doneAt: a.done_at,
    completedComment: a.completed_comment,
    completedPhotoPath: a.completed_photo_path,
    contactExplicitlyCleared: contactCleared.has(a.id),
    companyExplicitlyCleared: companyCleared.has(a.id),
    dueDateExplicitlyCleared: dueDateCleared.has(a.id),
  }
}

const byCbo = new Map()
for (const m of members) {
  const list = byCbo.get(m.canonical_business_object_id) ?? []
  list.push(m)
  byCbo.set(m.canonical_business_object_id, list)
}
console.log(`\n${byCbo.size} CBO distinct(s) portant au moins une Action dans le périmètre.`)

let groupsWithMultiple = 0
let groupsMerge = 0
let groupsBlockedReopened = 0
let groupsBlockedMultipleDone = 0
let orderInvariantOk = 0
let orderInvariantFail = 0
const mergeRows = []
const blockedRows = []
const invarianceFailures = []

function siteLabel(siteId) {
  const s = siteById.get(siteId)
  return s ? `${s.name} [${siteId}]` : siteId
}

for (const [cboId, memberRows] of byCbo.entries()) {
  const memberActionIds = [...new Set(memberRows.map((m) => m.member_entity_id))]
  if (memberActionIds.length <= 1) continue
  groupsWithMultiple += 1

  const rawActions = memberActionIds.map((id) => actionById.get(id))
  const siteId = rawActions[0]?.site_id
  const groupActions = rawActions.map(toCandidate)

  const outcomeForward = planActionCboReconciliation(groupActions)
  const outcomeReversed = planActionCboReconciliation([...groupActions].reverse())
  const invariant = outcomeEqual(outcomeForward, outcomeReversed)
  if (invariant) orderInvariantOk += 1
  else {
    orderInvariantFail += 1
    invarianceFailures.push({ cboId, siteId, outcomeForward, outcomeReversed })
  }

  const outcome = outcomeForward
  if (outcome.kind === 'none') continue

  const header = `\n--- CBO ${cboId} | site=${siteLabel(siteId)} (${memberActionIds.length} actions membres) | invariant=${invariant ? 'OK' : 'ÉCHEC'} ---`
  console.log(header)
  for (const a of [...groupActions].sort((x, y) => x.businessDate.localeCompare(y.businessDate))) {
    console.log(
      `  [${a.id}] businessDate=${a.businessDate} (created_at=${a.createdAt}) status=${a.status} ` +
        `superseded_by=${a.supersededBy ?? 'null'} ` +
        `contact=${a.assignedContactId ?? 'null'}${a.contactExplicitlyCleared ? '(retiré humainement)' : ''} ` +
        `entreprise=${a.assignedCompanyId ?? 'null'}${a.companyExplicitlyCleared ? '(retirée humainement)' : ''} ` +
        `echeance=${a.dueDate ?? 'null'}${a.dueDateExplicitlyCleared ? '(vidée humainement)' : ''} ` +
        `title="${(a.title || '').slice(0, 70)}"`,
    )
  }

  if (outcome.kind === 'blocked_done_durable') {
    if (outcome.reason === 'reopened_after_done') groupsBlockedReopened += 1
    else groupsBlockedMultipleDone += 1
    blockedRows.push({ cboId, siteId, ...outcome })
    console.log(`  → BLOQUÉ (${outcome.reason}) : durable=${outcome.durableId} — aucune fusion, en attente d'arbitrage humain: ${outcome.pendingActiveIds.join(', ')}`)
    continue
  }

  groupsMerge += 1
  mergeRows.push({ cboId, siteId, ...outcome })
  console.log(`  → FUSION : durable=${outcome.durableId} | perdante(s) superseded=${outcome.loserIds.join(', ')} | patch=${JSON.stringify(outcome.patch)}`)
}

console.log('\n=== RÉCAPITULATIF GLOBAL ===')
console.log(`Chantiers dans le périmètre : ${scopeIds.length}`)
console.log(`Groupes CBO avec >1 action membre : ${groupsWithMultiple}`)
console.log(`Groupes → FUSION : ${groupsMerge}`)
console.log(`Groupes → BLOQUÉ reopened_after_done (cas B) : ${groupsBlockedReopened}`)
console.log(`Groupes → BLOQUÉ multiple_done_occurrences (cas E) : ${groupsBlockedMultipleDone}`)
console.log(`Invariance par permutation (forward === reversed) : OK=${orderInvariantOk} ÉCHEC=${orderInvariantFail}`)
if (invarianceFailures.length > 0) {
  console.log('\n=== ÉCHECS D\'INVARIANCE (devraient être 0) ===')
  console.log(JSON.stringify(invarianceFailures, null, 2))
}
console.log('\nAUCUNE ÉCRITURE EFFECTUÉE — script lecture seule (pas d\'appel RPC fn_apply_action_cbo_merge).')

console.log('\n=== JSON ===')
console.log(JSON.stringify({
  scope: { totalSites: scopeIds.length },
  groupsWithMultiple,
  groupsMerge,
  groupsBlockedReopened,
  groupsBlockedMultipleDone,
  orderInvariantOk,
  orderInvariantFail,
  mergeRows,
  blockedRows,
}, null, 2))
