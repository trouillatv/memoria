// Observation S3.5 (KPI Vincent) — « % de contenus réellement rattachés ».
//
// LE KPI le plus important de S3 : 5 % ⇒ scopes décoratifs ; 80 % ⇒ structure
// réelle de la mémoire. Lecture seule. Borné au compte demo@memoria.nc (comme
// seed-scopes-demo.ts) — ne touche jamais une autre entreprise.
//
// Sert à mesurer, sur Médipôle :
//   Test A — couverture des suggestions sur le contenu non rattaché
//   Test C — % de contenu finalement rattaché (relancer à J+7 pour la tendance)
//
// Usage : npx tsx scripts/dev/scope-stats.ts
//
// Test B (suggestion acceptée sans correction) se mesure séparément, à partir des
// événements usage_events `scope_attach:{accepted|overridden|manual}` qui
// s'accumulent à chaque rattachement dans le panneau « À rattacher ».

import { createAdminClient } from '@/lib/supabase/admin'
import { getScopeAttachmentStats } from '@/lib/db/scope-suggestions'

import { readFileSync } from 'node:fs'
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* vars déjà exportées */
  }
}
loadEnvLocal()

const DEMO_EMAIL = 'demo@memoria.nc'

async function main() {
  const supabase = createAdminClient()

  // Org du compte démo, et elle seule.
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 })
  const authUser = list?.users?.find((u) => u.email === DEMO_EMAIL)
  if (!authUser) { console.error(`Compte démo introuvable (${DEMO_EMAIL}).`); process.exit(1) }
  const { data: profile } = await supabase
    .from('users').select('organization_id').eq('id', authUser.id).maybeSingle()
  const orgId = (profile as { organization_id: string } | null)?.organization_id
  if (!orgId) { console.error('Pas d’organization_id pour le compte démo.'); process.exit(1) }

  // Sites de l'org qui ont au moins un scope (les autres n'ont rien à mesurer).
  const { data: scopeSites } = await supabase
    .from('memory_scopes').select('site_id').eq('organization_id', orgId).is('deleted_at', null)
  const siteIds = [...new Set((scopeSites ?? []).map((r) => (r as { site_id: string }).site_id))]
  if (siteIds.length === 0) { console.log('Aucun site avec sous-périmètres dans le compte démo.'); return }

  const { data: sites } = await supabase.from('sites').select('id, name').in('id', siteIds)
  const nameById = new Map((sites ?? []).map((s) => [(s as { id: string }).id, (s as { name: string }).name]))

  console.log(`Compte démo : ${DEMO_EMAIL}  ·  org ${orgId}\n`)
  for (const siteId of siteIds) {
    const stats = await getScopeAttachmentStats(siteId, orgId)
    console.log(`■ ${nameById.get(siteId) ?? siteId}`)
    console.log(`  Rattaché (KPI) : ${stats.overall.attached}/${stats.overall.total} = ${stats.overall.pct}%`)
    for (const t of stats.byType) {
      console.log(`    - ${t.kind.padEnd(8)} ${t.attached}/${t.total} (${t.pct}%)`)
    }
    console.log(
      `  Test A — couverture suggestions : ${stats.unattached.withSuggestion}/${stats.unattached.count} non rattachés ont une suggestion (${stats.unattached.coveragePct}%)`,
    )
    console.log('')
  }
  console.log('Repère : <10% = scopes décoratifs · >80% = structure réelle de la mémoire.')
}

main().catch((e) => { console.error(e); process.exit(1) })
