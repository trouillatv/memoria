// P0-B — dry-run READ-ONLY final, périmètre STRICT Centre commercial Dumbéa Mall
// (Vincent 2026-09-17, après application 413+414 + smoke test). Aucune écriture,
// aucun appel RPC fn_apply_action_cbo_merge. Miroir exact de
// lib/db/action-cbo-reconciliation.ts (P0-B.2, businessDate).
//
// Rapporte pour chaque groupe CBO : id CBO, Action durable, candidate(s)
// superseded, date métier de chaque membre, statuts, champs qui seraient
// absorbés, protections humaines en jeu, provenance PV préservée, résultat
// final attendu.

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

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// 1. Résoudre le site "Centre commercial Dumbéa Mall" STRICTEMENT (pas Hyper).
const { data: sites, error: sitesErr } = await supabase
  .from('sites').select('id, name, phase').ilike('name', '%dumb%a mall%')
if (sitesErr) throw sitesErr
const site = sites.find((s) => /centre commercial/i.test(s.name))
if (!site) throw new Error('Centre commercial Dumbéa Mall introuvable: ' + JSON.stringify(sites))
console.log(`Site = ${site.name} [${site.id}] phase=${site.phase}`)

// 2. Actions du site + rattachement CBO.
const { data: actions, error: actionsErr } = await supabase
  .from('site_actions')
  .select('id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
  .eq('site_id', site.id)
if (actionsErr) throw actionsErr
const actionById = new Map(actions.map((a) => [a.id, a]))
const actionIds = actions.map((a) => a.id)
console.log(`${actions.length} action(s) sur ce chantier.`)

const { data: members, error: membersErr } = await supabase
  .from('canonical_business_object_member')
  .select('canonical_business_object_id, member_entity_id')
  .eq('member_entity_type', 'site_action')
  .in('member_entity_id', actionIds)
if (membersErr) throw membersErr

// 3. Provenance PV (site_reports : started_at = date métier, title = libellé PV).
const reportIds = [...new Set(actions.map((a) => a.report_id).filter(Boolean))]
const reportById = new Map()
for (const idsChunk of chunk(reportIds, 150)) {
  const { data, error } = await supabase.from('site_reports').select('id, started_at, title, created_at').in('id', idsChunk)
  if (error) throw error
  for (const r of data) reportById.set(r.id, r)
}

// 4. Contact / entreprise / échéance retirés humainement (before_value).
const eventRows = []
for (const idsChunk of chunk(actionIds, 150)) {
  const { data, error } = await supabase
    .from('site_action_events')
    .select('action_id, kind, before_value, after_value')
    .in('action_id', idsChunk)
    .in('kind', ['unassigned', 'due_date_changed'])
  if (error) throw error
  eventRows.push(...data)
}
const contactCleared = new Set()
const companyCleared = new Set()
const dueDateCleared = new Set()
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
    id: a.id,
    reportId: a.report_id,
    reportLabel: report ? `${report.title ?? '(sans titre)'} · started_at=${report.started_at ?? 'null'}` : '(aucun rapport source)',
    businessDate,
    status: a.status,
    supersededBy: a.superseded_by,
    title: a.title,
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
  list.push(m.member_entity_id)
  byCbo.set(m.canonical_business_object_id, list)
}

let n = 0
for (const [cboId, ids] of byCbo.entries()) {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length <= 1) continue
  n += 1
  const rawActions = uniqueIds.map((id) => actionById.get(id))
  const candidates = rawActions.map(toCandidate)
  const outcome = planActionCboReconciliation(candidates)

  console.log(`\n=== GROUPE ${n} — CBO ${cboId} (${uniqueIds.length} actions membres) ===`)
  for (const c of [...candidates].sort((a, b) => a.businessDate.localeCompare(b.businessDate))) {
    console.log(
      `  [${c.id}] businessDate=${c.businessDate} status=${c.status} superseded_by=${c.supersededBy ?? 'null'}\n` +
      `      titre="${(c.title || '').slice(0, 90)}"\n` +
      `      provenance PV: ${c.reportLabel} (report_id=${c.reportId ?? 'null'})\n` +
      `      contact=${c.assignedContactId ?? 'null'}${c.contactExplicitlyCleared ? ' [retiré humainement — protégé]' : ''} ` +
      `entreprise=${c.assignedCompanyId ?? 'null'}${c.companyExplicitlyCleared ? ' [retirée humainement — protégée]' : ''} ` +
      `echeance=${c.dueDate ?? 'null'}${c.dueDateExplicitlyCleared ? ' [vidée humainement — protégée]' : ''}`,
    )
  }

  if (outcome.kind === 'none') {
    console.log('  → RÉSULTAT ATTENDU : aucune action (tous déjà cancelled/supersedeed, ou 1 seul actif).')
    continue
  }
  if (outcome.kind === 'blocked_done_durable') {
    console.log(`  → RÉSULTAT ATTENDU : BLOQUÉ (${outcome.reason}) — AUCUNE écriture, arbitrage humain requis sur : ${outcome.pendingActiveIds.join(', ')}. Durable pressenti=${outcome.durableId}.`)
    continue
  }

  console.log(`  → RÉSULTAT ATTENDU : FUSION AUTO_SAFE`)
  console.log(`    Durable (identité conservée) = ${outcome.durableId}`)
  console.log(`    Candidate(s) superseded → cancelled = ${outcome.loserIds.join(', ')}`)
  console.log(`    Champs absorbés sur la durable (patch) = ${JSON.stringify(outcome.patch)}`)
  console.log(`    Provenance préservée : chaque Action perdante garde son report_id/canonical_business_object_member (jamais de DELETE) — PV d'origine de chaque membre listés ci-dessus restent tous rattachés au CBO.`)
}

console.log(`\n=== TOTAL GROUPES MULTI-MEMBRES SUR CE CHANTIER : ${n} ===`)
console.log('\nAUCUNE ÉCRITURE EFFECTUÉE — script lecture seule (pas d\'appel RPC fn_apply_action_cbo_merge).')
