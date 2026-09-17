// P0-B.5 — FINAL RESIDUAL BODY REVIEW (GO Vincent 2026-09-17). READ-ONLY.
//
// Ne rouvre PAS P0-B.3 : aucun UUID durable ne change, aucun superseded_by,
// aucune fusion, aucune membership CBO touchée. Le gel P0-B.3 porte sur
// l'IDENTITÉ durable/loser (laquelle des deux actions est "la" durable),
// jamais sur la conservation documentaire du contenu texte de la durable
// actuelle telle qu'elle est aujourd'hui.
//
// Portée : les 3 durables actuelles (déjà en place, jamais changées) dont le
// body reste vide après P0-B.4, parce qu'elles appartiennent aux 3 groupes
// d'identité gelés P0-B.3 (le moteur, rechargé avec body, désignerait un
// AUTRE membre comme durable — donc P0-B.4 les a exclues par construction) :
//   996f92ca…, b650502e…, e39a5a72…
//
// Pour chacune : affiche durable (title/body actuels), tous les losers de
// son CBO (title/body/source PV/document/date métier), compare les bodies
// non vides entre eux, puis classe :
//   SAFE_CONTENT_COPY   → durable.body vide + un seul contenu informatif
//                         distinct (ou plusieurs losers avec le même texte
//                         normalisé) + aucune contradiction.
//   CONTENT_AMBIGUOUS   → au moins deux bodies non vides et différents.
//   NO_CONTENT          → aucun loser n'a de body non vide (rien à copier).
//
// AUCUNE ÉCRITURE. AUCUN APPEL RPC.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const TARGET_DURABLE_PREFIXES = ['996f92ca', 'b650502e', 'e39a5a72']

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function normalize(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name').eq('name', 'Hyper Dumbéa Mall')
if (sitesErr) throw sitesErr
if (sites.length !== 1) throw new Error(`Site Hyper Dumbéa Mall : ${sites.length} résultat(s) exact(s)`)
const site = sites[0]

const { data: actions, error: actionsErr } = await supabase
  .from('site_actions')
  .select('id, report_id, created_at, status, superseded_by, title, body')
  .eq('site_id', site.id)
if (actionsErr) throw actionsErr
const actionById = new Map(actions.map((a) => [a.id, a]))

const targetDurables = actions.filter((a) => TARGET_DURABLE_PREFIXES.some((p) => a.id.startsWith(p)))
if (targetDurables.length !== 3) {
  throw new Error(`Attendu 3 durables cibles, trouvé ${targetDurables.length} : ${targetDurables.map((a) => a.id).join(',')}`)
}

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
const cboByAction = new Map()
const membersByCbo = new Map()
for (const m of members) {
  cboByAction.set(m.member_entity_id, m.canonical_business_object_id)
  const list = membersByCbo.get(m.canonical_business_object_id) ?? []
  list.push(m.member_entity_id)
  membersByCbo.set(m.canonical_business_object_id, list)
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

function describeSource(a) {
  const report = a.report_id ? reportById.get(a.report_id) : undefined
  const document = report?.source_document_id ? documentById.get(report.source_document_id) : undefined
  const businessDate = report?.started_at ?? document?.effective_date ?? a.created_at
  return {
    reportId: a.report_id ?? null,
    reportTitle: report?.title ?? null,
    documentEffectiveDate: document?.effective_date ?? null,
    businessDate,
  }
}

console.log(`Site = ${site.name} [${site.id}]`)
console.log(`=== P0-B.5 — AUDIT READ-ONLY DES 3 DURABLES RÉSIDUELLES ===\n`)

const verdicts = []

for (const durable of targetDurables) {
  const cboId = cboByAction.get(durable.id)
  const memberIds = [...new Set(membersByCbo.get(cboId) ?? [])]
  const losers = memberIds
    .map((id) => actionById.get(id))
    .filter(Boolean)
    .filter((a) => a.id !== durable.id && a.status === 'cancelled' && a.superseded_by === durable.id)

  console.log(`--- CBO ${cboId} — durable ${durable.id} ---`)
  console.log(`  durable.title = ${JSON.stringify(durable.title)}`)
  console.log(`  durable.body  = ${JSON.stringify(durable.body)}`)
  console.log(`  ${losers.length} loser(s) superseded vers cette durable :`)

  const nonEmptyBodies = []
  for (const loser of losers) {
    const src = describeSource(loser)
    const bodyPreview = loser.body ? loser.body.slice(0, 300) : null
    console.log(`    loser ${loser.id} — title=${JSON.stringify(loser.title)}`)
    console.log(`      body = ${bodyPreview ? JSON.stringify(bodyPreview) : 'null/vide'}`)
    console.log(`      source: report="${src.reportTitle ?? '(sans titre)'}" document.effective_date="${src.documentEffectiveDate ?? 'null'}" businessDate=${src.businessDate}`)
    if (loser.body && String(loser.body).trim() !== '') {
      nonEmptyBodies.push({ loserId: loser.id, body: loser.body, normalized: normalize(loser.body), source: src })
    }
  }

  const distinctNormalized = [...new Set(nonEmptyBodies.map((b) => b.normalized))]
  let classification
  let proposedBody = null
  if (nonEmptyBodies.length === 0) {
    classification = 'NO_CONTENT'
  } else if (distinctNormalized.length === 1) {
    classification = 'SAFE_CONTENT_COPY'
    proposedBody = nonEmptyBodies[0].body
  } else {
    classification = 'CONTENT_AMBIGUOUS'
  }

  console.log(`  bodies non vides distincts (normalisés) = ${distinctNormalized.length}`)
  console.log(`  CLASSIFICATION = ${classification}`)
  if (classification === 'SAFE_CONTENT_COPY') {
    console.log(`  → body proposé (copie du seul contenu informatif prouvé) : ${JSON.stringify(proposedBody)}`)
  }
  if (classification === 'CONTENT_AMBIGUOUS') {
    console.log('  → CONTRADICTION, textes distincts remontés pour arbitrage humain :')
    nonEmptyBodies.forEach((b, i) => console.log(`     [${i + 1}] loser ${b.loserId} : ${JSON.stringify(b.body)}`))
  }
  console.log('')

  verdicts.push({ cboId, durableId: durable.id, classification, proposedBody, nonEmptyBodies })
}

console.log('=== RÉCAPITULATIF ===')
for (const v of verdicts) {
  console.log(`  durable=${v.durableId} CBO=${v.cboId} → ${v.classification}`)
}
console.log('\nAUCUNE ÉCRITURE EFFECTUÉE — script lecture seule.')
