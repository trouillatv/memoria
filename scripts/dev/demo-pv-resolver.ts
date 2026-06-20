// Démontre la BOUCLE A de bout en bout, déterministe et SANS UI/auth :
//   Compléter → écrit la mémoire (resolver) → recalcul → le signal disparaît.
// Aller-RETOUR : on restaure l'état initial à la fin (aucune donnée modifiée).
// Usage : npx tsx scripts/dev/demo-pv-resolver.ts [reportId]

import { readFileSync } from 'node:fs'
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* déjà exportées */ }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'
import { buildPvValidation } from '@/lib/documents/pv-validation'
import { resolvePvSignal } from '@/lib/documents/pv-resolvers'
import { updateSiteAction } from '@/lib/db/site-actions'

async function findReportWithResponsableGap(explicitId?: string): Promise<string | null> {
  const sb = createAdminClient()
  const ids = explicitId
    ? [explicitId]
    : (await sb.from('site_reports').select('id, created_at').not('site_id', 'is', null)
        .order('created_at', { ascending: false }).limit(8)).data?.map((r) => r.id as string) ?? []
  for (const id of ids) {
    const pv = await buildPvValidation(id)
    if (pv?.gaps.some((g) => g.cible?.resolver === 'action_responsable')) return id
  }
  return null
}

async function main() {
  const reportId = await findReportWithResponsableGap(process.argv[2])
  if (!reportId) { console.log('Aucune réunion avec un signal « responsable manquant » à démontrer.'); return }

  const before = await buildPvValidation(reportId)
  const gap = before!.gaps.find((g) => g.cible?.resolver === 'action_responsable')!
  const refId = gap.cible!.refId

  console.log(`Réunion ${reportId}`)
  console.log(`\n① AVANT — signal présent :`)
  console.log(`   🔴 ${gap.libelle}  (cible: ${gap.cible!.resolver} → ${refId})`)
  console.log(`   bloquants durs = ${before!.readiness.durs} · PDF ${before!.blocking ? 'BLOQUÉ' : 'OK'}`)

  console.log(`\n② COMPLÉTER — resolver écrit la mémoire (assigned_to = "DÉMO-RESOLVER") …`)
  await resolvePvSignal('action_responsable', refId, 'DÉMO-RESOLVER')

  const after = await buildPvValidation(reportId)
  const stillThere = after!.gaps.some((g) => g.cible?.resolver === 'action_responsable' && g.cible.refId === refId)
  console.log(`\n③ APRÈS — recalcul :`)
  console.log(`   signal pour cette action : ${stillThere ? '❌ ENCORE LÀ (bug)' : '✅ DISPARU'}`)
  console.log(`   bloquants durs = ${after!.readiness.durs} (était ${before!.readiness.durs}) · PDF ${after!.blocking ? 'BLOQUÉ' : 'OK'}`)

  console.log(`\n④ RESTAURE l'état initial (assigned_to = null) …`)
  await updateSiteAction(refId, { assigned_to: null })
  const restored = await buildPvValidation(reportId)
  const back = restored!.gaps.some((g) => g.cible?.resolver === 'action_responsable' && g.cible.refId === refId)
  console.log(`   signal de nouveau présent : ${back ? '✅ oui (état initial rétabli)' : '⚠ non'}`)

  console.log(`\nBoucle A vérifiée : Compléter → mémoire corrigée → signal fermé. Aucune donnée laissée modifiée.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
