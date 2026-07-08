// Smoke test / déclencheur manuel de LA NUIT DE MEMORIA (mig 191).
// Rejoue exactement ce que fait le cron /api/cron/night-digest, puis relit le
// digest et montre la composition éditoriale du matin (pickMorningFocus).
//
// Usage : npx tsx --conditions=react-server scripts/dev/night-digest-smoke.ts
//
// Critère de succès : au moins 1 site traité, relecture du digest OK, exit 0.
import * as fs from 'fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { buildSiteMemorySignals } = await import('@/lib/db/site-memory-signals')
  const { writeSiteMorningDigest, getOrgMorningDigest, pickMorningFocus, isQuietMorning } = await import('@/lib/db/morning-digest')
  const { todayLocalIso } = await import('@/lib/time/local-date')

  const supabase = createAdminClient()
  const digestDate = todayLocalIso()
  console.log(`— La Nuit de MemorIA (smoke) — date civile Nouméa : ${digestDate}`)

  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, name, organization_id')
    .is('deleted_at', null)
    .eq('phase', 'actif')
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) { console.error('Listing sites failed:', error.message); process.exit(1) }
  if (!sites?.length) { console.error('Aucun chantier actif — rien à digérer.'); process.exit(1) }
  console.log(`${sites.length} chantier(s) actif(s)`)

  const orgIds = new Set<string>()
  let processed = 0, quiet = 0, items = 0
  for (const site of sites) {
    const t0 = Date.now()
    try {
      const signals = await buildSiteMemorySignals(site.id as string, digestDate)
      const wrote = await writeSiteMorningDigest({
        siteId: site.id as string,
        organizationId: (site.organization_id as string | null) ?? null,
        digestDate,
        signals,
        durationMs: Date.now() - t0,
      })
      if (!wrote.ok) { console.warn(`  ✗ ${site.name}: ${wrote.error}`); continue }
      const n = signals.reduce((k, s) => k + s.items.length, 0)
      processed++; items += n; if (n === 0) quiet++
      if (site.organization_id) orgIds.add(site.organization_id as string)
      console.log(`  ✓ ${site.name} — ${n} élément(s) de signal (${Date.now() - t0} ms)`)
    } catch (e) {
      console.warn(`  ✗ ${site.name}:`, (e as Error).message)
    }
  }
  console.log(`\nÉcrit : ${processed} digest(s), ${quiet} silencieux, ${items} éléments au total.`)
  if (processed === 0) process.exit(1)

  for (const orgId of orgIds) {
    const digest = await getOrgMorningDigest(orgId, digestDate)
    if (!digest) { console.error(`Relecture org ${orgId} : AUCUN digest — échec.`); process.exit(1) }
    console.log(`\n— Matin de l'org ${orgId} : ${digest.sites.length} site(s), ${digest.totalSignals} signaux, calculé ${digest.computedAt}`)
    if (isQuietMorning(digest)) {
      console.log('  Silence vert assumé (la nuit a tourné, rien à signaler).')
    } else {
      for (const f of pickMorningFocus(digest, 2)) {
        console.log(`  ★ ${f.siteName} — ${f.signal.title} (${f.signal.kind})`)
      }
    }
  }
  console.log('\nSmoke OK.')
}

main().catch((e) => { console.error(e); process.exit(1) })
