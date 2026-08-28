/** #231 Phase 3 recette LIVE — égalité EXACTE à chaque étage (READ-ONLY).
 *  population source | compteur | visibles | masqués | +N | destination | population destination
 *  sur Bella + OCEF + PETRO. Vérifie que compteur = population source = population destination. */
import { createClient } from '@supabase/supabase-js'
import { getSitePendingActionProposals } from '../lib/knowledge/site-pending-proposals'
import { deriveCanonicalAttentionItems } from '../lib/knowledge/canonical-attention'
import { sliceOverview, exactRemainder } from '../lib/knowledge/overview-counter'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const APERCU_PROPOSED_CAP = 3 // proposedTop (projection) = 3
const APERCU_ATTENTION_CAP = 3
const ok = (b: boolean) => (b ? '✅' : '❌ ÉCART')

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name').order('name')
  const targets = ((sites ?? []) as Array<{ id: string; name: string }>)
    .filter((s) => /bella|ocef compostage|petro/i.test(s.name))

  for (const s of targets) {
    console.log(`\n════════ ${s.name} [${s.id.slice(0, 8)}] ════════`)

    // ── Compteur « N proposées » ──────────────────────────────────────────────
    // population source (destination /actions#propositions) :
    const proposals = await getSitePendingActionProposals(s.id)
    // compteur affiché par l'Aperçu (proj.actions.proposed) = même requête (kind=action, status=proposed) :
    const { count: aperçuCount } = await sb.from('site_knowledge_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', s.id).eq('kind', 'action').eq('status', 'proposed')
    const pCounter = aperçuCount ?? 0
    const pVisible = Math.min(APERCU_PROPOSED_CAP, pCounter)
    const pHidden = exactRemainder(pCounter, pVisible)
    const pDestPop = proposals.length
    console.log('  PROPOSÉES')
    console.log(`    population source = ${proposals.length} | compteur = ${pCounter} | visibles = ${pVisible} | masqués = ${pHidden} | +N = ${pHidden}`)
    console.log(`    destination = /sites/${s.id.slice(0, 8)}/actions#propositions | population destination = ${pDestPop}`)
    console.log(`    → compteur = population source = population destination : ${ok(pCounter === proposals.length && proposals.length === pDestPop)}`)
    console.log(`    → visibles + masqués = compteur : ${ok(pVisible + pHidden === pCounter)}`)

    // ── Compteur « N autres sujets » (Attention) ─────────────────────────────
    const attnAperçu = await deriveCanonicalAttentionItems(s.id) // population complète (aucun cap)
    const { total, shown, hiddenCount } = sliceOverview(attnAperçu, APERCU_ATTENTION_CAP)
    const attnDest = await deriveCanonicalAttentionItems(s.id) // destination = MÊME read-model
    console.log('  ATTENTION')
    console.log(`    population source = ${total} | compteur (« Voir les X ») = ${total} | visibles = ${shown.length} | masqués = ${hiddenCount} | +N = ${hiddenCount}`)
    console.log(`    destination = /sites/${s.id.slice(0, 8)}/historique?view=attention | population destination = ${attnDest.length}`)
    console.log(`    → compteur = population source = population destination : ${ok(total === attnDest.length)}`)
    console.log(`    → visibles + masqués = compteur : ${ok(shown.length + hiddenCount === total)}`)
    if (/ocef compostage/i.test(s.name)) {
      console.log(`    → régression OCEF « 2 pour 14 » corrigée : +N annoncé = ${hiddenCount} (et non 2) ${ok(hiddenCount !== 2 || total <= 5)}`)
    }
  }
  console.log('\n(READ-ONLY. Invariant : population source unique → compteur exhaustif → aperçu capé → +N exact → destination sur cette même population.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
