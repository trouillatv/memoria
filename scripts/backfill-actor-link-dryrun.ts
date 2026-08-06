// Dry-run backfill actor_link sur canonical_subject
// npx tsx scripts/backfill-actor-link-dryrun.ts
//
// Pour chaque canonical_subject actif de kind=person|company :
//  - Recherche un match exact normalisé dans company_contacts (pour person)
//    ou companies (pour company), dans la même organisation que le chantier.
//  - Rapporte : auto (unique) / no_match (0) / ambiguous (>1)
//  - Ne modifie rien.
//
// Règle : jamais de match cross-org. L'organisation du chantier (sites.organization_id)
// est le seul périmètre de recherche.
//
// Normalisation : lowercase + trim + collapse whitespace (pas d'unaccent en V1).

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

async function fetchAll<T>(
  sb: ReturnType<typeof createAdminClient>,
  table: string,
  columns: string,
  filter: (q: ReturnType<typeof sb.from>) => ReturnType<typeof sb.from>
): Promise<T[]> {
  const PAGE = 1000
  const results: T[] = []
  let offset = 0
  while (true) {
    const q = filter(sb.from(table)).select(columns).range(offset, offset + PAGE - 1)
    const { data, error } = await (q as unknown as Promise<{ data: T[] | null; error: { message: string } | null }>)
    if (error) throw new Error(`fetchAll ${table}: ${error.message}`)
    if (!data?.length) break
    results.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return results
}

type MatchStatus = 'auto' | 'no_match' | 'ambiguous'
interface Result {
  csId: string
  label: string
  siteId: string
  siteName: string
  kind: 'person' | 'company'
  status: MatchStatus
  matchId?: string
  matchName?: string
  matchCount: number
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

  // 2 — Proposals de famille person|company → thread_ids
  const actorProps: Array<{ subject_thread_id: string; proposal_family: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family')
      .in('proposal_family', ['person', 'company'])
      .range(offset, offset + 999)
    if (error) throw error
    if (!data?.length) break
    actorProps.push(...data)
    if (data.length < 1000) break
  }
  console.log(`Proposals person|company : ${actorProps.length}`)

  if (!actorProps.length) { console.log('Aucune proposal actor trouvée.'); return }

  const actorThreadIds = [...new Set(actorProps.map(r => r.subject_thread_id).filter(Boolean))]
  console.log(`Thread IDs uniques (non-null) : ${actorThreadIds.length}`)

  // Famille dominante par thread (person ou company)
  const threadFamily = new Map<string, Map<string, number>>()
  for (const p of actorProps) {
    const m = threadFamily.get(p.subject_thread_id) ?? new Map<string, number>()
    m.set(p.proposal_family, (m.get(p.proposal_family) ?? 0) + 1)
    threadFamily.set(p.subject_thread_id, m)
  }

  // 3 — subject_thread_identity pour ces threads → canonical_subject_id
  const threadToCs = new Map<string, string>()
  for (let i = 0; i < actorThreadIds.length; i += BATCH) {
    const { data, error } = await sb
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', actorThreadIds.slice(i, i + BATCH))
      .limit(5000)
    if (error) console.error('STI query error:', error.message)
    if (i === 0) console.log(`STI batch 0: data=${data?.length ?? 'null'}, error=${error?.message ?? 'none'}`)
    for (const r of data ?? []) threadToCs.set(r.subject_thread_id, r.canonical_subject_id)
  }
  console.log(`threadToCs size : ${threadToCs.size}`)

  // 4 — Famille dominante par canonical_subject (person ou company)
  const csFamilyCounts = new Map<string, Map<string, number>>()
  for (const [tid, csId] of threadToCs) {
    const fam = threadFamily.get(tid)
    if (!fam) continue
    const csMap = csFamilyCounts.get(csId) ?? new Map<string, number>()
    for (const [f, n] of fam) csMap.set(f, (csMap.get(f) ?? 0) + n)
    csFamilyCounts.set(csId, csMap)
  }

  // 5 — Canonical subjects actifs pour ces IDs
  const actorCsIds = [...new Set(threadToCs.values())]
  console.log(`actorCsIds count : ${actorCsIds.length}`)
  const csRows: Array<{ id: string; site_id: string; label: string }> = []
  for (let i = 0; i < actorCsIds.length; i += BATCH) {
    const { data } = await sb
      .from('canonical_subject')
      .select('id, site_id, label, status')
      .in('id', actorCsIds.slice(i, i + BATCH))
      .eq('status', 'active')
      .limit(2000)
    for (const r of data ?? []) csRows.push(r)
  }
  console.log(`Canonical subjects actifs actor : ${csRows.length}`)

  // 6 — Kind par canonical_subject
  const csKind = new Map<string, 'person' | 'company'>()
  for (const cs of csRows) {
    const counts = csFamilyCounts.get(cs.id)
    if (!counts) continue
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (dominant === 'person' || dominant === 'company') csKind.set(cs.id, dominant)
  }

  // 7 — Contacts par org
  const contactsByOrg = new Map<string, Array<{ id: string; name: string }>>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from('company_contacts')
      .select('id, full_name, organization_id')
      .is('deleted_at', null)
      .range(offset, offset + 999)
    if (error) throw error
    if (!data?.length) break
    for (const c of data) {
      const list = contactsByOrg.get(c.organization_id) ?? []
      list.push({ id: c.id, name: c.full_name })
      contactsByOrg.set(c.organization_id, list)
    }
    if (data.length < 1000) break
  }

  // 8 — Entreprises par org
  const companiesByOrg = new Map<string, Array<{ id: string; name: string }>>()
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
      list.push({ id: c.id, name: c.name })
      companiesByOrg.set(c.organization_id, list)
    }
    if (data.length < 1000) break
  }

  // 9 — Résolution
  function resolve(candidates: Array<{ id: string; name: string }>, label: string): { status: MatchStatus; matchId?: string; matchName?: string; matchCount: number } {
    const norm = normalize(label)
    const hits = candidates.filter(c => normalize(c.name) === norm)
    if (hits.length === 1) return { status: 'auto', matchId: hits[0].id, matchName: hits[0].name, matchCount: 1 }
    if (hits.length === 0) return { status: 'no_match', matchCount: 0 }
    return { status: 'ambiguous', matchCount: hits.length }
  }

  const personResults: Result[] = []
  const companyResults: Result[] = []

  for (const cs of csRows) {
    const kind = csKind.get(cs.id)
    if (!kind) continue
    const orgId = siteOrgMap.get(cs.site_id) ?? ''
    const siteName = siteNameMap.get(cs.site_id) ?? cs.site_id.slice(0, 8)

    if (kind === 'person') {
      const candidates = (contactsByOrg.get(orgId) ?? [])
      const r = resolve(candidates, cs.label)
      personResults.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, kind, ...r })
    } else {
      const candidates = (companiesByOrg.get(orgId) ?? [])
      const r = resolve(candidates, cs.label)
      companyResults.push({ csId: cs.id, label: cs.label, siteId: cs.site_id, siteName, kind, ...r })
    }
  }

  // 10 — Rapport
  const pAuto = personResults.filter(r => r.status === 'auto')
  const pNone = personResults.filter(r => r.status === 'no_match')
  const pAmb  = personResults.filter(r => r.status === 'ambiguous')
  const cAuto = companyResults.filter(r => r.status === 'auto')
  const cNone = companyResults.filter(r => r.status === 'no_match')
  const cAmb  = companyResults.filter(r => r.status === 'ambiguous')

  console.log('\n=== Dry-run backfill actor_link — canonical_subject ===')
  console.log(`\nPERSONNES   : ${personResults.length} total → ${pAuto.length} auto · ${pNone.length} sans match · ${pAmb.length} ambiguës`)
  console.log(`ENTREPRISES : ${companyResults.length} total → ${cAuto.length} auto · ${cNone.length} sans match · ${cAmb.length} ambiguës`)

  const printSection = (title: string, items: Result[]) => {
    if (!items.length) return
    console.log(`\n── ${title} ──`)
    for (const r of items) {
      const match = r.matchName ? ` → "${r.matchName}"` : r.matchCount > 1 ? ` → ${r.matchCount} candidats` : ''
      console.log(`  [${r.csId.slice(0, 8)}] "${r.label}"${match}  (${r.siteName})`)
    }
  }

  printSection('Personnes : exact unique → seront liées', pAuto)
  printSection('Personnes : sans match', pNone)
  printSection('Personnes : ambiguës → non liées', pAmb)
  printSection('Entreprises : exact unique → seront liées', cAuto)
  printSection('Entreprises : sans match', cNone)
  printSection('Entreprises : ambiguës → non liées', cAmb)

  const totalAuto = pAuto.length + cAuto.length
  const totalSkip = pNone.length + pAmb.length + cNone.length + cAmb.length
  console.log(`\nRésumé : ${totalAuto} lien(s) auto à appliquer · ${totalSkip} sans lien automatique`)
  console.log('(Aucune modification effectuée — dry-run)\n')
}

main().catch(console.error)
