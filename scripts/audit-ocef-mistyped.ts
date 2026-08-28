/** READ-ONLY — date + caractérise les business_subject OCEF mistypés (personnes / nom de chantier / doc).
 *  Historique (pré-#228) ou reproductible aujourd'hui ? + twins acteurs (fragmentation). Aucune écriture. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const ocef = ((sites ?? []) as Array<{ id: string; name: string }>).find((s) => s.id.startsWith('06c62e48'))
  if (!ocef) { console.log('OCEF 06c62e48 introuvable'); return }
  const S = ocef.id

  // Répartition kind + dates sur OCEF
  const { data: allCs } = await sb.from('canonical_subject').select('id, label, kind, creation_source, created_at').eq('site_id', S)
  const rows = (allCs ?? []) as Array<{ id: string; label: string; kind: string | null; creation_source: string | null; created_at: string }>
  const byKind = new Map<string, number>()
  for (const r of rows) byKind.set(r.kind ?? 'null', (byKind.get(r.kind ?? 'null') ?? 0) + 1)
  console.log(`OCEF ${S.slice(0, 8)} — total canonical_subject = ${rows.length}`)
  console.log('  répartition kind :', JSON.stringify(Object.fromEntries(byKind)))

  const bs = rows.filter((r) => r.kind === 'business_subject')
  const dates = bs.map((r) => r.created_at).sort()
  console.log(`  business_subject = ${bs.length} · créés de ${dates[0]?.slice(0, 10)} à ${dates[dates.length - 1]?.slice(0, 10)}`)

  // Personnes mistypées : label ressemble à une personne
  const persons = bs.filter((r) => /\b(M\.|Mme|Monsieur|Madame)\b/i.test(r.label) || /DOUYERE|ROUSSEL/i.test(r.label))
  console.log(`\n  ── PERSONNES en business_subject = ${persons.length} ──`)
  for (const p of persons) console.log(`    ${p.created_at.slice(0, 10)}  occ? ${p.id.slice(0, 8)}  src=${p.creation_source}  « ${p.label} »`)

  // Twins acteurs : existe-t-il un canonical_subject kind=actor pour le même nom ? (fragmentation F)
  const names = [...new Set(persons.map((p) => p.label.trim().toLowerCase()))]
  for (const nm of names) {
    const twins = rows.filter((r) => r.label.trim().toLowerCase() === nm)
    const kinds = twins.map((t) => t.kind)
    console.log(`    « ${nm} » → ${twins.length} CS, kinds=[${kinds.join(', ')}]${twins.length > 1 ? ' ⚠️ FRAGMENT/DUPLICATE' : ''}`)
  }

  // Nom de chantier / projet / doc en business_subject
  const ctx = bs.filter((r) => /^ocef\b|co-?compostage|plateforme|date du compte|compte.?rendu|proc[eè]s.?verbal/i.test(r.label.trim()))
  console.log(`\n  ── CONTEXTE (nom chantier/projet/doc) en business_subject = ${ctx.length} ──`)
  for (const c of ctx.slice(0, 20)) console.log(`    ${c.created_at.slice(0, 10)}  ${c.id.slice(0, 8)}  « ${c.label} »`)

  // occurrences pour un échantillon de personnes (inertes ou actives ?)
  console.log('\n  ── occurrences des personnes mistypées ──')
  for (const p of persons.slice(0, 6)) {
    const { count } = await sb.from('canonical_subject_occurrence').select('id', { count: 'exact', head: true }).eq('canonical_subject_id', p.id)
    console.log(`    « ${p.label} » occ=${count}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
