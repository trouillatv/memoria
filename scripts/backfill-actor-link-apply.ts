// Apply backfill actor_link — entreprises uniquement (source='auto')
// npx tsx scripts/backfill-actor-link-apply.ts
//
// Applique les liens company_id sur les canonical_subject actifs de kind=company
// dont la résolution est exacte et sans ambiguïté.
//
// Règles :
//  - Exact match normalisé, même organisation que le chantier.
//  - Ne modifie pas si company_id est déjà renseigné vers une autre entreprise → conflict.
//  - Idempotent : si company_id est déjà la bonne valeur → skipped.
//  - actor_link_source = 'auto', actor_link_confidence = 1.000.
//  - actor_link_validated_at / validated_by = NULL (liens auto, pas de validation humaine).
//  - Vérifie la cohérence org company/site avant toute écriture.

import { existsSync, readFileSync } from 'node:fs'
function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

import { createAdminClient } from '../lib/supabase/admin'

const BATCH = 400

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

interface ApplyResult {
  csId: string
  label: string
  siteId: string
  siteName: string
  companyId: string
  companyName: string
  outcome: 'linked' | 'skipped' | 'conflict' | 'org_mismatch' | 'error'
  detail?: string
}

async function main() {
  const sb = createAdminClient()

  // 1 — Sites avec org
  const { data: siteRows } = await sb.from('sites').select('id, organization_id, name').limit(5000)
  const siteOrgMap = new Map<string, string>()
  const siteNameMap = new Map<string, string>()
  for (const r of siteRows ?? []) {
    siteOrgMap.set(r.id, r.organization_id)
    siteNameMap.set(r.id, r.name)
  }

  // 2 — Proposals de famille company → thread_ids
  const actorProps: Array<{ subject_thread_id: string | null; proposal_family: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family')
      .eq('proposal_family', 'company')
      .range(offset, offset + 999)
    if (error) throw error
    if (!data?.length) break
    actorProps.push(...data)
    if (data.length < 1000) break
  }

  const actorThreadIds = [...new Set(actorProps.map(r => r.subject_thread_id).filter(Boolean))] as string[]

  // 3 — subject_thread_identity → canonical_subject_id
  const threadToCs = new Map<string, string>()
  for (let i = 0; i < actorThreadIds.length; i += BATCH) {
    const { data } = await sb
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', actorThreadIds.slice(i, i + BATCH))
      .limit(5000)
    for (const r of data ?? []) threadToCs.set(r.subject_thread_id, r.canonical_subject_id)
  }

  const actorCsIds = [...new Set(threadToCs.values())]

  // 4 — Canonical subjects actifs de kind=company (avec company_id actuel pour idempotence)
  const csRows: Array<{ id: string; site_id: string; label: string; company_id: string | null; contact_id: string | null }> = []
  for (let i = 0; i < actorCsIds.length; i += BATCH) {
    const { data } = await sb
      .from('canonical_subject')
      .select('id, site_id, label, status, company_id, contact_id')
      .in('id', actorCsIds.slice(i, i + BATCH))
      .eq('status', 'active')
      .limit(2000)
    for (const r of data ?? []) csRows.push(r)
  }

  // 5 — Entreprises par org
  const companiesByOrg = new Map<string, Array<{ id: string; name: string; org: string }>>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from('companies')
      .select('id, name, organization_id')
      .is('deleted_at', null)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data?.length) break
    for (const c of data) {
      const list = companiesByOrg.get(c.organization_id) ?? []
      list.push({ id: c.id, name: c.name, org: c.organization_id })
      companiesByOrg.set(c.organization_id, list)
    }
    if (data.length < 1000) break
  }

  // 6 — Résoudre et appliquer
  const results: ApplyResult[] = []

  for (const cs of csRows) {
    const orgId = siteOrgMap.get(cs.site_id) ?? ''
    const siteName = siteNameMap.get(cs.site_id) ?? cs.site_id.slice(0, 8)
    const candidates = (companiesByOrg.get(orgId) ?? [])
    const norm = normalize(cs.label)
    const hits = candidates.filter(c => normalize(c.name) === norm)

    if (hits.length !== 1) continue // no_match ou ambiguous → skip silencieusement

    const matched = hits[0]

    // Vérification org cohérence (double sécurité)
    if (matched.org !== orgId) {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'org_mismatch', detail: `company.org=${matched.org} ≠ site.org=${orgId}` })
      continue
    }

    // Idempotent : déjà lié à la bonne entreprise
    if (cs.company_id === matched.id) {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'skipped', detail: 'déjà lié' })
      continue
    }

    // Conflit : déjà lié à une autre entreprise
    if (cs.company_id !== null) {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'conflict', detail: `company_id existant: ${cs.company_id.slice(0, 8)}` })
      continue
    }

    // Contact déjà renseigné (ne devrait pas arriver pour kind=company)
    if (cs.contact_id !== null) {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'conflict', detail: `contact_id déjà renseigné: ${cs.contact_id.slice(0, 8)}` })
      continue
    }

    // Apply
    const { error } = await sb
      .from('canonical_subject')
      .update({
        company_id: matched.id,
        actor_link_source: 'auto',
        actor_link_confidence: 1.000,
        actor_link_validated_at: null,
        actor_link_validated_by: null,
      })
      .eq('id', cs.id)
      .eq('status', 'active')
      .is('company_id', null)  // préventif : n'écrase jamais

    if (error) {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'error', detail: error.message })
    } else {
      results.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, companyId: matched.id, companyName: matched.name, outcome: 'linked' })
    }
  }

  // 7 — Rapport
  const linked   = results.filter(r => r.outcome === 'linked')
  const skipped  = results.filter(r => r.outcome === 'skipped')
  const conflict = results.filter(r => r.outcome === 'conflict')
  const orgMism  = results.filter(r => r.outcome === 'org_mismatch')
  const errors   = results.filter(r => r.outcome === 'error')

  console.log('\n=== Apply backfill actor_link — entreprises ===')
  console.log(`\nlinked   : ${linked.length}`)
  console.log(`skipped  : ${skipped.length}  (déjà liés)`)
  console.log(`conflict : ${conflict.length}`)
  console.log(`org_mism : ${orgMism.length}`)
  console.log(`error    : ${errors.length}`)

  if (linked.length)   { console.log('\n── Linked ──'); for (const r of linked)   console.log(`  [${r.csId.slice(0,8)}] "${r.label}" → ${r.companyName}  (${r.siteName})`) }
  if (skipped.length)  { console.log('\n── Skipped ──'); for (const r of skipped)  console.log(`  [${r.csId.slice(0,8)}] "${r.label}"  (${r.siteName})`) }
  if (conflict.length) { console.log('\n── Conflict ──'); for (const r of conflict) console.log(`  [${r.csId.slice(0,8)}] "${r.label}" — ${r.detail}  (${r.siteName})`) }
  if (orgMism.length)  { console.log('\n── Org mismatch ──'); for (const r of orgMism) console.log(`  [${r.csId.slice(0,8)}] "${r.label}" — ${r.detail}`) }
  if (errors.length)   { console.log('\n── Errors ──'); for (const r of errors) console.log(`  [${r.csId.slice(0,8)}] "${r.label}" — ${r.detail}`) }

  console.log('\n(Modifications effectuées en base)\n')
}

main().catch(console.error)
