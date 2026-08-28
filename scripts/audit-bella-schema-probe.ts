/** READ-ONLY — découvre les colonnes de canonical_subject_occurrence + trouve « BELLA NAPOLI » comme CS. */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const ONE = '8815498b-3100-43b9-9038-bf479c658a29' // Largeur de passage des dégagements

async function main() {
  const { data: occ } = await sb.from('canonical_subject_occurrence').select('*').eq('canonical_subject_id', ONE).limit(2)
  console.log('── colonnes canonical_subject_occurrence ──')
  console.log(Object.keys((occ ?? [{}])[0] ?? {}).join(', '))
  console.log('exemple:', JSON.stringify((occ ?? [])[0], null, 1))

  const { data: cs } = await sb.from('canonical_subject').select('*').eq('id', ONE).maybeSingle()
  console.log('\n── colonnes canonical_subject ──')
  console.log(Object.keys(cs ?? {}).join(', '))

  // Chercher « BELLA NAPOLI » comme canonical_subject
  const { data: bellaSubjects } = await sb.from('canonical_subject')
    .select('id, label, kind, created_at')
    .eq('site_id', BELLA).ilike('label', '%bella%')
  console.log('\n── canonical_subject dont le label contient « bella » ──')
  for (const r of (bellaSubjects ?? []) as Array<{ id: string; label: string; kind: string; created_at: string }>) {
    console.log(`  ${r.id.slice(0, 8)}  kind=${r.kind}  « ${r.label} »`)
  }

  // Tous les business_subject Bella (pour transversalité label-chantier/doc)
  const { data: allBs } = await sb.from('canonical_subject')
    .select('id, label, kind').eq('site_id', BELLA).eq('kind', 'business_subject')
  console.log(`\n── total business_subject Bella = ${(allBs ?? []).length} ──`)
}
main().catch((e) => { console.error(e); process.exit(1) })
