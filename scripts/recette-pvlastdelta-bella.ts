/** Recette pvLastDelta convergence — READ-ONLY. Ferme le HARD STOP mobile/Copilote.
 *  Vérifie que le consommateur RÉEL (getSiteOverview().pvLastDelta, désormais
 *  occurrence-first via buildOccurrencePvSummary) converge avec la vérité P0 :
 *  12 nouveaux, 3 réouverts, 3 résolus, 2 non mentionnés ; réouvert ≠ aggravé ;
 *  électrique/cuisson/nettoyage = réouvert ; séparation = non mentionné ; aucun acteur. */
import { createClient } from '@supabase/supabase-js'
import { getSiteOverview } from '../lib/knowledge/site-overview'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { buildOccurrencePvSummary } from '../lib/documents/occurrence-pv-summary'
import { getActorCanonicalIds } from '../lib/documents/occurrence-population'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (b: boolean) => (b ? '✅' : '❌')
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function main() {
  let allGreen = true
  const check = (b: boolean) => { if (!b) allGreen = false; return ok(b) }

  console.log('════════ RECETTE pvLastDelta — BELLA NAPOLI ════════\n')

  // ── 1. Le consommateur RÉEL : getSiteOverview().pvLastDelta ────────────────
  const ov = await getSiteOverview(BELLA)
  const d = ov.pvLastDelta
  if (!d) { console.log('❌ pvLastDelta null — abort'); process.exit(1) }
  console.log('pvLastDelta (getSiteOverview, occurrence-first) :')
  console.log(`   nouveaux=${d.nouveaux}  réouverts=${d.réouverts}  aggravés=${d.aggravés}  résolus=${d.résolus}`)
  console.log(`   nouveaux = 12  : ${check(d.nouveaux === 12)}`)
  console.log(`   réouverts = 3  : ${check(d.réouverts === 3)}`)
  console.log(`   résolus = 3    : ${check(d.résolus === 3)}`)
  console.log(`   réouvert ≠ aggravé (champs séparés présents) : ${check(typeof d.réouverts === 'number' && typeof d.aggravés === 'number')}`)

  // ── 2. Cross-check avec la source partagée + non mentionné (hors pvLastDelta) ─
  const runs = await canonicalRunsForSite(BELLA)
  const syn = await buildOccurrencePvSummary(BELLA, runs[runs.length - 2].id, runs[runs.length - 1].id)
  console.log('\nbuildOccurrencePvSummary (source partagée) :')
  console.log(`   nouveau=${syn.nouveau.length} réouvert=${syn.réouvert.length} résolu=${syn.résolu.length} nonMentionné=${syn.nonMentionné.length}`)
  console.log(`   pvLastDelta == summary (nouveaux/réouverts/résolus) : ${check(d.nouveaux === syn.nouveau.length && d.réouverts === syn.réouvert.length && d.résolus === syn.résolu.length)}`)
  console.log(`   non mentionné = 2 : ${check(syn.nonMentionné.length === 2)}`)

  // ── 3. Invariant par sujet témoin ─────────────────────────────────────────
  const inCat = (cat: keyof typeof syn, re: RegExp) => (syn[cat] as Array<{ label: string }>).some((x) => re.test(x.label))
  console.log('\ntémoins Bella :')
  console.log(`   électrique → réouvert       : ${check(inCat('réouvert', /Contrôle des installations électriques/i))}`)
  console.log(`   cuisson → réouvert          : ${check(inCat('réouvert', /cuisson/i))}`)
  console.log(`   nettoyage → réouvert        : ${check(inCat('réouvert', /Nettoyage/i))}`)
  console.log(`   séparation → non mentionné  : ${check(inCat('nonMentionné', /Séparation des flux/i))}`)

  // ── 4. Aucun acteur dans la population du delta ───────────────────────────
  const actorCs = await getActorCanonicalIds(BELLA)
  const allRefs = [...syn.nouveau, ...syn.réouvert, ...syn.aggravé, ...syn.résolu, ...syn.nonMentionné]
  const actorLeak = allRefs.filter((r) => actorCs.has(r.canonicalSubjectId))
  console.log(`\n   aucun acteur dans le delta : ${check(actorLeak.length === 0)}${actorLeak.length ? ' — fuite: ' + actorLeak.map(r => r.label).join(', ') : ''}`)

  console.log(`\n════════ ${allGreen ? '✅ RECETTE VERTE' : '❌ RECETTE ROUGE'} ════════`)
  process.exit(allGreen ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
