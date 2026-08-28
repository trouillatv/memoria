/** Recette P0 Phase 2B — Historique PV occurrence-first. READ-ONLY. Doit converger avec Synthèse/Aperçu. */
import { createClient } from '@supabase/supabase-js'
import { buildOccurrenceActivityMap } from '../lib/documents/occurrence-population'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (b: boolean) => (b ? '✅' : '❌')
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function show(siteId: string, name: string) {
  const map = await buildOccurrenceActivityMap(siteId)
  console.log(`\n### ${name} — ${map.rows.length} lignes, ${map.runs.length} PV`)
  const lastIdx = map.runs.length - 1
  let nouveaux = 0, reopened = 0
  for (const r of map.rows) {
    const firstReal = r.cells.findIndex((c) => c.state !== 'absent')
    if (firstReal === lastIdx && lastIdx > 0) nouveaux++
    if (r.cells.some((c) => c.state === 'reopened')) reopened++
  }
  console.log(`   nouveaux (1re apparition au dernier PV) = ${nouveaux} · réouverts (cellule reopened) = ${reopened}`)
  if (/bella/i.test(name)) {
    const lbl = (re: RegExp) => map.rows.find((r) => re.test(r.label) && r.cells.some((c) => c.state === 'reopened'))
    console.log(`   grille NON vide : ${ok(map.rows.length > 0)}`)
    console.log(`   électrique reopened : ${ok(!!lbl(/installations électriques/i))}`)
    console.log(`   cuisson reopened : ${ok(!!lbl(/cuisson/i))}`)
    console.log(`   nettoyage reopened : ${ok(!!lbl(/Nettoyage/i))}`)
    console.log(`   12 nouveaux : ${ok(nouveaux === 12)}`)
    console.log(`   3 réouverts : ${ok(reopened === 3)}`)
    // aucun acteur dans les lignes
    const actorLike = map.rows.filter((r) => /BELLA NAPOLI|BOUVIER|Véritas|Veritas|KFT|MIES|LOMBARDI|DELORME|CANEPA|Velayoudon|PROVENZANO|DEMARQUET|LACHOQUE|DSCGR|CAPSE|SACD|VHZ/i.test(r.label))
    console.log(`   aucun acteur dans les lignes : ${ok(actorLike.length === 0)}${actorLike.length ? ' → ' + actorLike.map((r) => r.label).join(', ') : ''}`)
    // témoins électrique/cuisson : dernière cellule reopened (resolved→reopened)
    const elec = map.rows.find((r) => /installations électriques/i.test(r.label))
    console.log(`   électrique cells = [${elec?.cells.map((c) => c.state).join(', ')}] (attendu ~ done→reopened)`)
  }
}

async function main() {
  await show(BELLA, 'BELLA NAPOLI')
  const { data: sites } = await sb.from('sites').select('id, name')
  const list = (sites ?? []) as Array<{ id: string; name: string }>
  for (const s of list.filter((x) => /^ocef compostage$|lyc[eé]e petro/i.test(x.name.trim()))) {
    const map = await buildOccurrenceActivityMap(s.id)
    if (map.rows.length > 0) { await show(s.id, s.name); break }
  }
  console.log('\n(READ-ONLY. Grille = occurrences ; acteurs exclus #228 ; knowledge_fact gardé ; aucun seuil.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
