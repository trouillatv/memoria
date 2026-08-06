// Dry-run résolution des personnes non liées — LECTURE SEULE, aucune écriture DB
// npx tsx scripts/dry-run-person-resolution.ts
//
// Trouve tous les canonical_subjects actifs sans company_id ni contact_id qui ont
// au moins une proposition de famille 'person', puis tente comparerNoms() contre
// tous les contacts de l'organisation. Rapporte les résultats sans écrire.

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
import { comparerNoms, normaliserNom } from '../lib/acteurs/resolution-identite'

type RowOutcome =
  | 'identique'
  | 'initiale-et-nom'
  | 'orthographe-proche'
  | 'prenom-seul'
  | 'ambiguous'
  | 'no_match'

interface Row {
  csId: string
  siteId: string
  label: string
  outcome: RowOutcome
  matchCount: number
  bestMatch?: { contactId: string; name: string; regle: string; score: number; company: string | null }
}

async function main() {
  const sb = createAdminClient()

  // 1. Tous les CS actifs non liés (company_id IS NULL AND contact_id IS NULL)
  const { data: allUnlinked } = await sb
    .from('canonical_subject')
    .select('id, site_id, label')
    .eq('status', 'active')
    .is('company_id', null)
    .is('contact_id', null)

  if (!allUnlinked?.length) {
    console.log('Aucun canonical_subject non lié trouvé.')
    return
  }

  // 2. Filtrer ceux qui ont au moins une proposition de famille 'person'
  //    via subject_thread_identity
  const allCsIds = allUnlinked.map(r => r.id as string)

  const { data: stiRows } = await sb
    .from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('canonical_subject_id', allCsIds)

  const csIdToThreadIds = new Map<string, string[]>()
  for (const r of stiRows ?? []) {
    const list = csIdToThreadIds.get(r.canonical_subject_id) ?? []
    list.push(r.subject_thread_id)
    csIdToThreadIds.set(r.canonical_subject_id, list)
  }

  const allThreadIds = [...new Set((stiRows ?? []).map(r => r.subject_thread_id))]
  const threadHasPersonFamily = new Set<string>()

  if (allThreadIds.length > 0) {
    const { data: propRows } = await sb
      .from('document_extraction_proposal')
      .select('subject_thread_id, proposal_family')
      .in('subject_thread_id', allThreadIds)
      .eq('proposal_family', 'person')
    for (const r of propRows ?? []) {
      threadHasPersonFamily.add(r.subject_thread_id)
    }
  }

  const personCsIds = new Set(
    allUnlinked
      .map(r => r.id as string)
      .filter(csId => {
        const threads = csIdToThreadIds.get(csId) ?? []
        return threads.some(tid => threadHasPersonFamily.has(tid))
      }),
  )

  const personCSRows = allUnlinked.filter(r => personCsIds.has(r.id as string))
  console.log(`\n=== Dry-run résolution personnes non liées ===`)
  console.log(`CS actifs non liés total : ${allUnlinked.length}`)
  console.log(`Dont famille 'person'     : ${personCSRows.length}\n`)

  if (!personCSRows.length) {
    console.log('Aucun à résoudre.')
    return
  }

  // 3. Pour chaque CS, charger les contacts de l'org du chantier
  //    On groupe par site_id pour éviter de re-requêter la même org
  const siteIds = [...new Set(personCSRows.map(r => r.site_id as string))]

  const { data: siteRows } = await sb
    .from('sites')
    .select('id, organization_id')
    .in('id', siteIds)

  const siteToOrg = new Map((siteRows ?? []).map(r => [r.id as string, r.organization_id as string]))
  const orgIds = [...new Set(siteToOrg.values())]

  // Contacts par org
  const { data: companyRows } = await sb
    .from('companies')
    .select('id, organization_id')
    .in('organization_id', orgIds)
    .is('deleted_at', null)

  const companyByOrg = new Map<string, string[]>()
  for (const c of companyRows ?? []) {
    const list = companyByOrg.get(c.organization_id as string) ?? []
    list.push(c.id as string)
    companyByOrg.set(c.organization_id as string, list)
  }

  const allCompanyIds = (companyRows ?? []).map(c => c.id as string)
  const { data: contactRows } = await sb
    .from('company_contacts')
    .select('id, full_name, company_id')
    .in('company_id', allCompanyIds)
    .is('deleted_at', null)

  // Enrichir avec le nom de l'entreprise pour le rapport
  const { data: companyNameRows } = await sb
    .from('companies')
    .select('id, name')
    .in('id', allCompanyIds)
    .is('deleted_at', null)
  const companyNames = new Map((companyNameRows ?? []).map(c => [c.id as string, c.name as string]))

  const contactsByOrg = new Map<string, Array<{ id: string; full_name: string; company_id: string; company_name: string | null }>>()
  for (const c of contactRows ?? []) {
    const compId = c.company_id as string
    // Retrouver l'org via la company
    for (const [orgId, compIds] of companyByOrg) {
      if (compIds.includes(compId)) {
        const list = contactsByOrg.get(orgId) ?? []
        list.push({ id: c.id as string, full_name: c.full_name as string, company_id: compId, company_name: companyNames.get(compId) ?? null })
        contactsByOrg.set(orgId, list)
        break
      }
    }
  }

  // 4. Résolution par CS
  const rows: Row[] = []

  for (const cs of personCSRows) {
    const orgId = siteToOrg.get(cs.site_id as string)
    if (!orgId) { rows.push({ csId: cs.id as string, siteId: cs.site_id as string, label: cs.label as string, outcome: 'no_match', matchCount: 0 }); continue }

    const contacts = contactsByOrg.get(orgId) ?? []

    interface Hit { contactId: string; name: string; regle: string; score: number; company: string | null }
    const hits: Hit[] = []

    for (const contact of contacts) {
      const result = comparerNoms(cs.label as string, contact.full_name)
      if (result) {
        hits.push({ contactId: contact.id, name: contact.full_name, regle: result.regle, score: result.score, company: contact.company_name })
      }
    }

    // Trier par score décroissant
    hits.sort((a, b) => b.score - a.score)

    if (hits.length === 0) {
      rows.push({ csId: cs.id as string, siteId: cs.site_id as string, label: cs.label as string, outcome: 'no_match', matchCount: 0 })
    } else if (hits.length > 1 && hits[0]!.score === hits[1]!.score) {
      rows.push({ csId: cs.id as string, siteId: cs.site_id as string, label: cs.label as string, outcome: 'ambiguous', matchCount: hits.length, bestMatch: hits[0] })
    } else {
      const best = hits[0]!
      rows.push({ csId: cs.id as string, siteId: cs.site_id as string, label: cs.label as string, outcome: best.regle as RowOutcome, matchCount: hits.length, bestMatch: best })
    }
  }

  // 5. Rapport
  const byOutcome = {
    identique: rows.filter(r => r.outcome === 'identique'),
    'initiale-et-nom': rows.filter(r => r.outcome === 'initiale-et-nom'),
    'orthographe-proche': rows.filter(r => r.outcome === 'orthographe-proche'),
    'prenom-seul': rows.filter(r => r.outcome === 'prenom-seul'),
    ambiguous: rows.filter(r => r.outcome === 'ambiguous'),
    no_match: rows.filter(r => r.outcome === 'no_match'),
  }

  console.log(`── Résultats ──────────────────────────────────────────`)
  console.log(`identique         : ${byOutcome.identique.length}  (auto-linkable, confiance 100%)`)
  console.log(`initiale-et-nom   : ${byOutcome['initiale-et-nom'].length}  (auto-linkable, confiance 90%)`)
  console.log(`orthographe-proche: ${byOutcome['orthographe-proche'].length}  (suggestion humaine, confiance 80%)`)
  console.log(`prenom-seul       : ${byOutcome['prenom-seul'].length}  (suggestion humaine, confiance 70%)`)
  console.log(`ambiguous         : ${byOutcome.ambiguous.length}  (plusieurs candidats de même score)`)
  console.log(`no_match          : ${byOutcome.no_match.length}  (aucun contact correspondant)`)

  if (byOutcome.identique.length) {
    console.log('\n── Identique (auto-linkable) ──')
    for (const r of byOutcome.identique) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}" → "${r.bestMatch?.name}" (${r.bestMatch?.company ?? 'sans entreprise'})`)
    }
  }

  if (byOutcome['initiale-et-nom'].length) {
    console.log('\n── Initiale-et-nom (auto-linkable) ──')
    for (const r of byOutcome['initiale-et-nom']) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}" → "${r.bestMatch?.name}" (${r.bestMatch?.company ?? 'sans entreprise'})`)
    }
  }

  if (byOutcome['orthographe-proche'].length) {
    console.log('\n── Orthographe proche (suggestion) ──')
    for (const r of byOutcome['orthographe-proche']) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}" → "${r.bestMatch?.name}" (${r.bestMatch?.company ?? 'sans entreprise'})  score=${r.bestMatch?.score}`)
    }
  }

  if (byOutcome['prenom-seul'].length) {
    console.log('\n── Prénom seul (suggestion) ──')
    for (const r of byOutcome['prenom-seul']) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}" → "${r.bestMatch?.name}" (${r.bestMatch?.company ?? 'sans entreprise'})  score=${r.bestMatch?.score}`)
    }
  }

  if (byOutcome.ambiguous.length) {
    console.log('\n── Ambiguous ──')
    for (const r of byOutcome.ambiguous) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}"  (${r.matchCount} candidats, meilleur="${r.bestMatch?.name}")`)
    }
  }

  if (byOutcome.no_match.length) {
    console.log('\n── No match ──')
    for (const r of byOutcome.no_match) {
      console.log(`  [${r.csId.slice(0,8)}] "${r.label}"`)
    }
  }

  const autoLinkable = byOutcome.identique.length + byOutcome['initiale-et-nom'].length
  console.log(`\n→ ${autoLinkable}/${personCSRows.length} auto-linkables sans écriture DB`)
  console.log('(DRY-RUN : aucune modification effectuée)\n')
}

main().catch(console.error)
