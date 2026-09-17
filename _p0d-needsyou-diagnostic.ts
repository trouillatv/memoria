// P0-D — diagnostic READ-ONLY : confirmer la cartographie déjà auditée (les 5 files qui
// alimentent "MemorIA a besoin de toi" ne comptent pas la même unité que Pilotage).
// Réutilise directement loadMemoriaNeedsYouSummary + filterMemoriaNeedsYouQuestionsForPoint
// (code de production réel), aucune réimplémentation. Aucune écriture.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'

const DIAGNOSTIC_USER_ID = '67ff5e23-230f-44cd-9a1e-2bb466851c43' // admin@memoria.nc — utilisé uniquement pour getTrackedPointReviews (état de revue par utilisateur), sans effet sur les compteurs NeedsYou

async function main() {
  const supabase = createAdminClient()
  const { data: sites, error } = await supabase.from('sites').select('id, name').eq('name', 'Centre commercial Dumbéa Mall')
  if (error) throw error
  if (sites.length !== 1) throw new Error(`site introuvable exact : ${JSON.stringify(sites)}`)
  const site = sites[0]
  console.log(`Site = ${site.name} [${site.id}]`)

  const summary = await loadMemoriaNeedsYouSummary(site.id)
  console.log(`\ntotalCount (questions logiques, page globale) = ${summary.totalCount}`)
  for (const c of summary.categories) {
    console.log(`  ${c.category} (${c.label}) = ${c.count}`)
  }

  const { points } = await loadSiteTrackedPointList(site.id, DIAGNOSTIC_USER_ID)
  console.log(`\n${points.length} Points chargés (tracked-point-list).`)

  let pointsWithNeedsYou = 0
  let pointsWithNeedsYouFieldPositive = 0
  let sumPerPointCount = 0
  const byCategoryAttributable: Record<string, number> = {}
  for (const p of points) {
    const matches = filterMemoriaNeedsYouQuestionsForPoint(summary.questions, p.id)
    if (matches.length > 0) pointsWithNeedsYou += 1
    if (p.needsYouCount > 0) pointsWithNeedsYouFieldPositive += 1
    if (matches.length !== p.needsYouCount) {
      console.log(`  DIVERGENCE point=${p.id} recompute=${matches.length} champ_reel=${p.needsYouCount}`)
    }
    sumPerPointCount += matches.length
    for (const m of matches) byCategoryAttributable[m.category] = (byCategoryAttributable[m.category] ?? 0) + 1
  }
  console.log(`\nPoints avec needsYouCount > 0 (recalcul local) = ${pointsWithNeedsYou}`)
  console.log(`Points avec needsYouCount > 0 (champ réel PointListEntry, = ce que Pilotage affiche) = ${pointsWithNeedsYouFieldPositive}`)
  console.log(`Somme des needsYouCount sur tous les Points = ${sumPerPointCount} (peut compter une question plusieurs fois si multi-Points)`)
  console.log('Répartition par catégorie des questions attribuables à au moins un Point :')
  for (const [cat, n] of Object.entries(byCategoryAttributable)) console.log(`  ${cat} = ${n}`)

  console.log('\nCatégories STRUCTURELLEMENT jamais attribuables à un Point (par construction du filtre) :')
  console.log(`  confirm_trackability = ${summary.categories.find((c) => c.category === 'confirm_trackability')?.count ?? 0} question(s) globales, 0 forcément visible en Pilotage`)
  console.log(`  clarify_evidence = ${summary.categories.find((c) => c.category === 'clarify_evidence')?.count ?? 0} question(s) globales, 0 forcément visible en Pilotage`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
