/** #232 replay READ-ONLY du garde établissement — sur les VRAIS acteurs person/company des runs
 *  Bella + alias réels du site. Critère : BELLA NAPOLI seule bloquée, aucun vrai acteur perdu.
 *  N'exécute PAS le pipeline (aucune écriture) — applique le prédicat pur au dataset réel. */
import { createClient } from '@supabase/supabase-js'
import { isSiteEstablishmentLabel } from '../lib/db/site-identity-guard'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  const { data: site } = await sb.from('sites').select('name, normalized_name').eq('id', BELLA).maybeSingle()
  const aliases = [(site as { name?: string } | null)?.name, (site as { normalized_name?: string } | null)?.normalized_name]
  console.log(`alias fiables du site = ${JSON.stringify(aliases)}`)

  const { data: reps } = await sb.from('site_reports').select('extraction_run_id').eq('site_id', BELLA)
  const runIds = ((reps ?? []) as Array<{ extraction_run_id: string | null }>).map((r) => r.extraction_run_id).filter(Boolean) as string[]
  const { data: actors } = await sb.from('document_extraction_proposal')
    .select('label, reviewed_label, proposal_family')
    .in('extraction_run_id', runIds.length ? runIds : ['-']).in('proposal_family', ['person', 'company'])
  const rows = (actors ?? []) as Array<{ label: string; reviewed_label: string | null; proposal_family: string }>
  const labels = [...new Set(rows.map((r) => r.reviewed_label ?? r.label))]

  console.log(`\n── ${labels.length} acteurs person/company extraits (dédupliqués) ──`)
  const blocked: string[] = []
  const kept: string[] = []
  for (const l of labels) {
    const isEstab = isSiteEstablishmentLabel(l, aliases)
    ;(isEstab ? blocked : kept).push(l)
    console.log(`  ${isEstab ? '⛔ BLOQUÉ (pas d\'identité acteur)' : '✅ conservé'}  « ${l} »`)
  }

  // Contre-exemples synthétiques (ne doivent JAMAIS être bloqués)
  const nearMiss = ['Bella Napoli Traiteur', 'Pizzeria Bella Napoli', 'BELLA NAPOLI SARL']
  console.log('\n── quasi-homonymes (doivent rester conservés) ──')
  for (const l of nearMiss) console.log(`  ${isSiteEstablishmentLabel(l, aliases) ? '⛔ BLOQUÉ ❌' : '✅ conservé'}  « ${l} »`)

  console.log('\n════ VÉRIFICATIONS ════')
  const onlyBn = blocked.length === 1 && /^\s*bella napoli\s*$/i.test(blocked[0].trim())
  console.log(`  BELLA NAPOLI seule bloquée : ${onlyBn ? '✅' : `❌ (bloqués = ${JSON.stringify(blocked)})`}`)
  console.log(`  aucun vrai acteur perdu (${kept.length} conservés) : ${kept.length === labels.length - blocked.length ? '✅' : '❌'}`)
  console.log(`  quasi-homonymes tous conservés : ${nearMiss.every((l) => !isSiteEstablishmentLabel(l, aliases)) ? '✅' : '❌'}`)
  console.log('\n(READ-ONLY — prédicat pur appliqué au dataset réel, aucune écriture.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
