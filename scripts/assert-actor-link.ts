// Assertions post-apply backfill actor_link entreprises
// npx tsx scripts/assert-actor-link.ts

import { existsSync, readFileSync } from 'node:fs'
function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

import { createAdminClient } from '../lib/supabase/admin'

async function main() {
  const sb = createAdminClient()
  let ok = true

  // 1. Nombre de liens auto actifs
  const { data: linked } = await sb
    .from('canonical_subject')
    .select('id, site_id, company_id, label')
    .eq('actor_link_source', 'auto')
    .not('company_id', 'is', null)
    .eq('status', 'active')
  const count = linked?.length ?? 0
  const assert1 = count === 23
  if (!assert1) ok = false
  console.log(`1. Liens auto actifs : ${count}  ${assert1 ? 'OK' : 'FAIL (attendu 23)'}`)
  if (!assert1 && linked) {
    for (const r of linked) console.log(`   [${r.id.slice(0,8)}] "${r.label}" site=${r.site_id.slice(0,8)}`)
  }

  // 2. Doublons site+company (index UNIQUE partiel aurait empêché, mais vérifions)
  const byKey = new Map<string, number>()
  for (const r of linked ?? []) {
    const k = `${r.site_id}|${r.company_id}`
    byKey.set(k, (byKey.get(k) ?? 0) + 1)
  }
  const dupeKeys = [...byKey.entries()].filter(([, n]) => n > 1)
  const assert2 = dupeKeys.length === 0
  if (!assert2) ok = false
  console.log(`2. Doublons site+company actifs : ${dupeKeys.length}  ${assert2 ? 'OK' : 'FAIL'}`)
  if (!assert2) for (const [k] of dupeKeys) console.log(`   ${k}`)

  // 3. FK orphelines
  const { data: companies } = await sb.from('companies').select('id').is('deleted_at', null)
  const validIds = new Set(companies?.map(c => c.id) ?? [])
  const orphans = (linked ?? []).filter(r => r.company_id && !validIds.has(r.company_id))
  const assert3 = orphans.length === 0
  if (!assert3) ok = false
  console.log(`3. FK orphelines : ${orphans.length}  ${assert3 ? 'OK' : 'FAIL'}`)

  // 4. Cross-org
  const { data: siteRows } = await sb.from('sites').select('id, organization_id').limit(5000)
  const { data: compRows } = await sb.from('companies').select('id, organization_id').is('deleted_at', null)
  const siteOrg = new Map((siteRows ?? []).map(r => [r.id, r.organization_id]))
  const compOrg = new Map((compRows ?? []).map(r => [r.id, r.organization_id]))
  const crossOrg = (linked ?? []).filter(r => siteOrg.get(r.site_id) !== compOrg.get(r.company_id!))
  const assert4 = crossOrg.length === 0
  if (!assert4) ok = false
  console.log(`4. Cross-org : ${crossOrg.length}  ${assert4 ? 'OK' : 'FAIL'}`)
  if (!assert4) for (const r of crossOrg) console.log(`   [${r.id.slice(0,8)}] "${r.label}"`)

  // 5. Aucun canonical_subject actif avec company_id non auto (vérifie pas de doublon avec lien manuel)
  const { data: allLinked } = await sb
    .from('canonical_subject')
    .select('id, company_id, actor_link_source')
    .not('company_id', 'is', null)
    .eq('status', 'active')
  const nonAuto = (allLinked ?? []).filter(r => r.actor_link_source !== 'auto')
  console.log(`5. Liens non-auto avec company_id : ${nonAuto.length}  (info)`)

  console.log(`\n${ok ? '✓ TOUTES ASSERTIONS OK' : '✗ ECHEC'}`)
}

main().catch(console.error)
