// P0-B/P0-C — dry-run READ-ONLY générique, classification AUTO_SAFE / NEEDS_HUMAN /
// AMBIGUOUS. Réutilisable pour tout chantier. Aucune écriture, aucun appel RPC.
// Usage : node _dryrun-p0b-classify.mjs "<nom exact du site>"
//
// Classification :
//   AUTO_SAFE   = outcome 'merge' avec patch VIDE (doublons déjà identiques
//                 champ par champ — fusion pure identité/statut).
//   AMBIGUOUS   = outcome 'merge' avec patch NON VIDE (un champ serait
//                 réellement absorbé sur la durable — traité prudemment comme
//                 nécessitant un regard humain pour cette campagne, même si
//                 le moteur le jugerait normalement automatisable).
//   NEEDS_HUMAN = outcome 'blocked_done_durable' (reopened_after_done ou
//                 multiple_done_occurrences) — arbitrage humain requis.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const siteNameExact = process.argv[2]
if (!siteNameExact) throw new Error('Usage: node _dryrun-p0b-classify.mjs "<nom exact du site>"')

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

const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name, phase').eq('name', siteNameExact)
if (sitesErr) throw sitesErr
if (sites.length !== 1) throw new Error(`Site "${siteNameExact}" : ${sites.length} résultat(s) exact(s) — ${JSON.stringify(sites)}`)
const site = sites[0]
console.log(`Site = ${site.name} [${site.id}] phase=${site.phase}`)

const { data: actions, error: actionsErr } = await supabase
  .from('site_actions')
  .select('id, report_id, created_at, status, superseded_by, title, body, assigned_to, assigned_contact_id, assigned_company_id, due_date, due_date_status, reserve_id, done_at, completed_comment, completed_photo_path')
  .eq('site_id', site.id)
if (actionsErr) throw actionsErr
const actionById = new Map(actions.map((a) => [a.id, a]))
const actionIds = actions.map((a) => a.id)
console.log(`${actions.length} action(s) sur ce chantier.`)

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
console.log(`${reportIds.length} PV source distincts (started_at null sur ${[...reportById.values()].filter(r=>r.started_at===null).length}/${reportIds.length}).`)

const eventRows = []
for (const idsChunk of chunk(actionIds, 150)) {
  if (idsChunk.length === 0) continue
  const { data, error } = await supabase
    .from('site_action_events').select('action_id, kind, before_value, after_value')
    .in('action_id', idsChunk).in('kind', ['unassigned', 'due_date_changed'])
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
    id: a.id, reportId: a.report_id,
    reportLabel: report ? `${report.title ?? '(sans titre)'} · started_at=${report.started_at ?? 'null'}` : '(aucun rapport source)',
    businessDate, status: a.status, supersededBy: a.superseded_by, title: a.title,
    assignedTo: a.assigned_to, assignedContactId: a.assigned_contact_id, assignedCompanyId: a.assigned_company_id,
    dueDate: a.due_date, dueDateStatus: a.due_date_status, reserveId: a.reserve_id, doneAt: a.done_at,
    completedComment: a.completed_comment, completedPhotoPath: a.completed_photo_path,
    contactExplicitlyCleared: contactCleared.has(a.id), companyExplicitlyCleared: companyCleared.has(a.id),
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

const counts = { AUTO_SAFE: 0, AMBIGUOUS: 0, NEEDS_HUMAN: 0, NONE: 0, UNKNOWN: 0 }
for (const g of groups) counts[g.classification]++
console.log(`\n=== TOTAL GROUPES MULTI-MEMBRES : ${groups.length} — AUTO_SAFE=${counts.AUTO_SAFE} AMBIGUOUS=${counts.AMBIGUOUS} NEEDS_HUMAN=${counts.NEEDS_HUMAN} ===`)

let n = 0
for (const g of groups) {
  n += 1
  console.log(`\n--- GROUPE ${n}/${groups.length} — CBO ${g.cboId} — ${g.classification} (${g.candidates.length} membres) ---`)
  for (const c of [...g.candidates].sort((a, b) => a.businessDate.localeCompare(b.businessDate))) {
    console.log(
      `  [${c.id}] businessDate=${c.businessDate} status=${c.status} superseded_by=${c.supersededBy ?? 'null'} titre="${(c.title || '').slice(0, 70)}"\n` +
      `      PV: ${c.reportLabel}\n` +
      `      contact=${c.assignedContactId ?? 'null'}${c.contactExplicitlyCleared ? ' [protégé]' : ''} entreprise=${c.assignedCompanyId ?? 'null'}${c.companyExplicitlyCleared ? ' [protégée]' : ''} echeance=${c.dueDate ?? 'null'}${c.dueDateExplicitlyCleared ? ' [protégée]' : ''}`,
    )
  }
  if (g.outcome.kind === 'merge') {
    console.log(`  → durable=${g.outcome.durableId} losers=${g.outcome.loserIds.join(',')} patch=${JSON.stringify(g.outcome.patch)}`)
  } else if (g.outcome.kind === 'blocked_done_durable') {
    console.log(`  → BLOQUÉ (${g.outcome.reason}) — durable pressenti=${g.outcome.durableId} pending=${g.outcome.pendingActiveIds.join(',')}`)
  }
}

console.log('\nAUCUNE ÉCRITURE EFFECTUÉE — script lecture seule.')
