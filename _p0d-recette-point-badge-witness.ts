// P0-D two-level doctrine (mandat Vincent 2026-09-17) — recette READ-ONLY, critère 4 :
// « si un vrai NeedsYou Point existe sur un autre témoin, son badge reste visible sur sa carte ».
// Cherche un site où au moins un Point a needsYouCount > 0 (champ réel PointListEntry, inchangé
// par ce lot) pour prouver que le mécanisme de badge Point n'a pas régressé. Aucune écriture.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { loadMemoriaNeedsYouSummary, computeChantierNeedsYouCount } from '@/lib/knowledge/tracked-point-needs-you-summary'

const DIAGNOSTIC_USER_ID = '67ff5e23-230f-44cd-9a1e-2bb466851c43'

async function main() {
  const supabase = createAdminClient()
  const { data: sites, error } = await supabase.from('sites').select('id, name').is('deleted_at', null)
  if (error) throw error

  let found = 0
  for (const site of sites ?? []) {
    const { points } = await loadSiteTrackedPointList(site.id, DIAGNOSTIC_USER_ID)
    const withBadge = points.filter((p) => p.needsYouCount > 0)
    if (withBadge.length === 0) continue
    found += 1
    const summary = await loadMemoriaNeedsYouSummary(site.id)
    const chantier = computeChantierNeedsYouCount(summary.categories)
    console.log(`Site = ${site.name} [${site.id}]`)
    console.log(`  Points avec badge NeedsYou (needsYouCount>0) = ${withBadge.length}/${points.length}`)
    for (const p of withBadge.slice(0, 3)) console.log(`    point=${p.id} label=${p.label} needsYouCount=${p.needsYouCount} needsYouQuestionId=${p.needsYouQuestionId}`)
    console.log(`  chantierNeedsYouCount (nouvelle carte dédiée) = ${chantier}`)
    console.log('')
    if (found >= 3) break
  }
  if (found === 0) console.log('Aucun site avec un Point needsYouCount>0 trouvé — critère 4 non démontrable en prod actuellement.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
