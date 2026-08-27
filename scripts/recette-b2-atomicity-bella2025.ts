/**
 * P3-B2-workflow — Recette dry-run de l'atomicité sur le CR Bella Napoli 2025.
 *
 * Reconstitue le texte source à partir des source_excerpt réels des propositions du run 2025
 * (les phrases exactes qui ont produit des propositions), le repasse dans l'extracteur AVEC le
 * nouveau contrat d'atomicité, et compare AVANT (base) / APRÈS (ré-extraction) sur TOUT le CR.
 *
 * Objectif : le composite « électrique + éclairage + cuisson à refaire » → 3 propositions atomiques,
 * SANS sur-splitter les autres phrases (conduits, coordination, etc.). AUCUNE écriture.
 *
 * Usage : npx tsx --env-file=.env.local scripts/recette-b2-atomicity-bella2025.ts
 */

import { createClient } from '@supabase/supabase-js'
import { extractHistoricalPvProposals } from '../lib/documents/historical-visit-extractor'

const RUN_2025 = '79a735e1-00a2-4af7-ad8d-d5a9add8f1c0'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function main() {
  const { data: props } = await sb.from('document_extraction_proposal')
    .select('label, proposal_family, source_excerpt, source_page')
    .eq('extraction_run_id', RUN_2025)
    .order('source_page', { ascending: true })
  const before = (props ?? []).filter(p => !['person', 'company'].includes(p.proposal_family))
  sep('AVANT — propositions métier en base (CR 2025)')
  for (const p of before) console.log(`  [${p.proposal_family}] p.${p.source_page ?? '?'} ${p.label}`)
  console.log(`\nTotal métier AVANT : ${before.length}`)

  // Reconstituer le texte source : source_excerpts distincts, par page, avec marqueurs [[page N]].
  const byPage = new Map<number, Set<string>>()
  for (const p of before) {
    const pg = p.source_page ?? 1
    const ex = (p.source_excerpt ?? p.label ?? '').trim()
    if (!ex) continue
    if (!byPage.has(pg)) byPage.set(pg, new Set())
    byPage.get(pg)!.add(ex)
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b)
  const text = pages.map(pg => `[[page ${pg}]]\n` + [...byPage.get(pg)!].join('\n')).join('\n\n')
  const pageCount = pages.length ? Math.max(...pages) : 1

  sep('Ré-extraction avec le nouveau contrat (dry-run, aucune écriture)')
  const res = await extractHistoricalPvProposals(text, pageCount)
  const after = res.proposals.filter(p => !['person', 'company'].includes(p.family))
  for (const p of after) console.log(`  [${p.family}] p.${p.sourcePage ?? '?'} ${p.label}`)
  console.log(`\nTotal métier APRÈS : ${after.length}`)

  sep('VÉRIFICATION atomicité')
  const has = (re: RegExp) => after.filter(p => re.test(p.label))
  const elec = has(/installations? électriques?|contrôle[s]? électrique/i)
  const eclair = has(/éclairage/i)
  const cuisson = has(/cuisson|appareils de cuisson/i)
  const checks: { name: string; ok: boolean; detail: string }[] = []
  checks.push({ name: 'MUST_SPLIT — électrique présent (séparé)', ok: elec.length >= 1, detail: elec.map(p => p.label).join(' | ') || '—' })
  checks.push({ name: 'MUST_SPLIT — éclairage présent (séparé)', ok: eclair.length >= 1, detail: eclair.map(p => p.label).join(' | ') || '—' })
  checks.push({ name: 'MUST_SPLIT — cuisson présent (séparé)', ok: cuisson.length >= 1, detail: cuisson.map(p => p.label).join(' | ') || '—' })
  // les 3 doivent être des propositions DISTINCTES
  const trio = new Set([...elec, ...eclair, ...cuisson].map(p => p.label))
  checks.push({ name: 'les 3 contrôles = propositions distinctes', ok: trio.size >= 3, detail: `${trio.size} distinctes` })
  // anti sur-split PRÉCIS : « air vicié / buée / graisse » ne doit jamais être éclaté en composants.
  // Un vrai sur-split = une proposition citant UN composant isolé (buée OU graisse) sans les autres.
  const conduitsProps = has(/conduit|bu[ée]e|graisse|air vici/i)
  const conduitsComponentSplit = conduitsProps.filter(p => {
    const l = p.label
    const mentionsComponent = /bu[ée]e|graisse|air vici/i.test(l)
    const keepsFullPhrase = /bu[ée]e/i.test(l) && /graisse/i.test(l) // les composants restent ensemble
    return mentionsComponent && !keepsFullPhrase
  })
  checks.push({ name: 'NON-split — composants conduits (air/buée/graisse) jamais isolés', ok: conduitsComponentSplit.length === 0, detail: conduitsComponentSplit.map(p => p.label).join(' | ') || '0 composant isolé' })
  // anti sur-split climatisation : les sous-éléments (groupe froid/chambre froide/clim) restent groupés
  const climaSplit = has(/groupe froid|chambre froide/i).filter(p => !/climatisation/i.test(p.label))
  checks.push({ name: 'NON-split — climatisation (groupe froid/chambre froide) groupée', ok: climaSplit.length === 0, detail: `${climaSplit.length} isolé(s)` })
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`)
  const allOk = checks.every(c => c.ok)

  // Compte global = INFORMATIF (pas un critère) : le LLM est non déterministe et une extraction
  // légitimement plus riche (faits knowledge_fact/deadline supplémentaires) gonfle le total sans
  // sur-split. Le vrai verdict = les gardes spécifiques ci-dessus.
  console.log(`\n  ℹ️  compte global (informatif) : ${before.length} → ${after.length}`)
  sep(allOk ? '✅ RECETTE ATOMICITÉ CONFORME (gardes split/non-split tous verts)' : '❌ RECETTE À REVOIR')
  console.log('Note : LLM non déterministe ; comparer les COMPTES d’atomicité (split/non-split), pas la reproduction exacte des libellés ni le total.')
}

main().catch((e) => { console.error(e); process.exit(1) })
