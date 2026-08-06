// Diagnostic des personnes non liées — dry-run élargi
// npx tsx scripts/diag-person-proposals.ts

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
import { comparerNoms } from '../lib/acteurs/resolution-identite'

async function main() {
  const sb = createAdminClient()

  const { count: personPropCount } = await sb.from('document_extraction_proposal')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_family', 'person')
  console.log('Proposals family=person total:', personPropCount)

  const { count: withThread } = await sb.from('document_extraction_proposal')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_family', 'person')
    .not('subject_thread_id', 'is', null)
  console.log('Person proposals WITH subject_thread_id:', withThread)

  const { count: stiTotal } = await sb.from('subject_thread_identity').select('id', { count: 'exact', head: true })
  console.log('STI total:', stiTotal)

  // CS actifs non liés avec STI
  const { data: csNonLies } = await sb.from('canonical_subject')
    .select('id, label, site_id, company_id, contact_id')
    .eq('status', 'active')
    .is('company_id', null)
    .is('contact_id', null)
  console.log('CS actifs non liés:', csNonLies?.length ?? 0)

  // Parmi eux, combien ont une STI ?
  const csIds = (csNonLies ?? []).map(r => r.id as string)
  if (!csIds.length) { console.log('Aucun CS non lié'); return }

  const { data: stiRows } = await sb.from('subject_thread_identity')
    .select('canonical_subject_id, subject_thread_id')
    .in('canonical_subject_id', csIds)
  const csWithSti = new Set((stiRows ?? []).map(r => r.canonical_subject_id as string))
  console.log('CS non liés avec STI:', csWithSti.size, '/ sans STI:', csIds.length - csWithSti.size)

  // Parmi ceux avec STI, combien ont un thread avec family=person ?
  const threadIds = (stiRows ?? []).map(r => r.subject_thread_id as string)
  if (threadIds.length) {
    const { data: personThreads } = await sb.from('document_extraction_proposal')
      .select('subject_thread_id')
      .in('subject_thread_id', threadIds)
      .eq('proposal_family', 'person')
    const personThreadSet = new Set((personThreads ?? []).map(r => r.subject_thread_id as string))
    console.log('Threads avec family=person dans CS non liés:', personThreadSet.size)

    // Familles présentes dans ces threads
    const { data: families } = await sb.from('document_extraction_proposal')
      .select('proposal_family, subject_thread_id')
      .in('subject_thread_id', threadIds.slice(0, 200))
    const familyCounts = new Map<string, number>()
    for (const r of families ?? []) {
      familyCounts.set(r.proposal_family, (familyCounts.get(r.proposal_family) ?? 0) + 1)
    }
    console.log('Familles dans les threads des CS non liés:', Object.fromEntries(familyCounts))
  }

  // 5 exemples de labels CS non liés
  console.log('\nExemples labels CS non liés:')
  for (const cs of (csNonLies ?? []).slice(0, 10)) {
    const hasSti = csWithSti.has(cs.id as string)
    console.log(`  [${(cs.id as string).slice(0,8)}] "${cs.label}"  STI=${hasSti}`)
  }

  // Détection heuristique : labels qui ressemblent à des noms de personnes (2 mots, capitalisés)
  const personLike = (csNonLies ?? []).filter(cs => {
    const label = (cs.label as string).trim()
    const words = label.split(/\s+/)
    // Nom de personne typique : 2 mots, chacun capitalisé ou initial
    return words.length >= 2 && words.length <= 4 && words.every(w => /^[A-ZÀ-Ü]/.test(w))
  })
  console.log(`\nCS non liés avec label personne-like (heuristique): ${personLike.length}`)
  for (const cs of personLike.slice(0, 20)) {
    console.log(`  [${(cs.id as string).slice(0,8)}] "${cs.label}"`)
  }

  // Tenter comparerNoms sur les person-like (lecture contacts org)
  if (personLike.length > 0) {
    const siteIds = [...new Set(personLike.map(r => r.site_id as string))]
    const { data: siteRows } = await sb.from('sites').select('id, organization_id').in('id', siteIds)
    const siteToOrg = new Map((siteRows ?? []).map(r => [r.id as string, r.organization_id as string]))
    const orgIds = [...new Set(siteToOrg.values())]

    const { data: companyRows } = await sb.from('companies').select('id, organization_id').in('organization_id', orgIds).is('deleted_at', null)
    const companyIds = (companyRows ?? []).map(c => c.id as string)
    const { data: contacts } = await sb.from('company_contacts').select('id, full_name, company_id').in('company_id', companyIds).is('deleted_at', null)

    console.log(`\nContacts disponibles dans l'org: ${contacts?.length ?? 0}`)
    console.log('\n── Résolution heuristique des person-like ──')
    let linked = 0, noMatch = 0, ambiguous = 0

    for (const cs of personLike) {
      const orgId = siteToOrg.get(cs.site_id as string)
      if (!orgId) continue
      const orgCompanyIds = new Set((companyRows ?? []).filter(c => c.organization_id === orgId).map(c => c.id as string))
      const orgContacts = (contacts ?? []).filter(c => orgCompanyIds.has(c.company_id as string))

      const hits = orgContacts
        .map(c => ({ c, result: comparerNoms(cs.label as string, c.full_name as string) }))
        .filter(x => x.result !== null)
        .sort((a, b) => b.result!.score - a.result!.score)

      if (hits.length === 0) { noMatch++; continue }
      if (hits.length > 1 && hits[0]!.result!.score === hits[1]!.result!.score) {
        ambiguous++
        console.log(`  AMBIG [${(cs.id as string).slice(0,8)}] "${cs.label}" → ${hits.map(h => `"${h.c.full_name}"(${h.result!.regle})`).join(', ')}`)
        continue
      }
      linked++
      const best = hits[0]!
      console.log(`  MATCH [${(cs.id as string).slice(0,8)}] "${cs.label}" → "${best.c.full_name}" (${best.result!.regle}, score=${best.result!.score})`)
    }
    console.log(`\n→ MATCH: ${linked} / AMBIG: ${ambiguous} / NO_MATCH: ${noMatch} (sur ${personLike.length} person-like)`)
  }
}

main().catch(console.error)
