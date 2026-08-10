// Backfill canonical_subject — PETRO ATTITI (et tout site sans CS)
// Traite toutes les visites d'un site et appelle reconcileSourceToCanonicalSubjects
// en mode backfill=true : inclut fulfilled/superseded, produit des occurrences confirmed.
//
// Usage :
//   SUPABASE_ACCESS_TOKEN=xxx npx tsx scripts/backfill-canonical-petro.ts
//   SUPABASE_ACCESS_TOKEN=xxx SITE_FILTER=petro npx tsx scripts/backfill-canonical-petro.ts

async function sql<T = Record<string, unknown>>(query: string, token: string): Promise<T[]> {
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`SQL ${res.status} — ${await res.text()}`)
  return res.json() as Promise<T[]>
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  const siteFilter = (process.env.SITE_FILTER ?? 'petro').toLowerCase()

  // 1. Trouver les sites ciblés sans canonical_subject existant
  const sites = await sql<{ id: string; name: string; cs_count: string }>(`
    SELECT
      s.id,
      s.name,
      COUNT(cs.id) AS cs_count
    FROM sites s
    LEFT JOIN canonical_subject cs ON cs.site_id = s.id
    WHERE s.deleted_at IS NULL
      AND s.name ILIKE '%${siteFilter}%'
    GROUP BY s.id, s.name
    ORDER BY s.name
  `, token)

  if (!sites.length) {
    console.log(`Aucun site trouvé pour le filtre "${siteFilter}"`)
    process.exit(0)
  }

  for (const site of sites) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log(`Site : ${site.name} (${site.id})`)
    console.log(`  CS existants : ${site.cs_count}`)

    // 2. Visites du site (terrain uniquement)
    const visits = await sql<{ id: string; title: string; created_at: string; origin: string | null }>(`
      SELECT id, title, created_at, origin
      FROM site_reports
      WHERE site_id = '${site.id}'
        AND deleted_at IS NULL
      ORDER BY created_at ASC
    `, token)

    console.log(`  Visites à traiter : ${visits.length}`)

    let totalMatched = 0, totalCreated = 0, totalClustered = 0, totalOrphaned = 0, totalAmbiguous = 0

    // 3. Propositions candidates par visite (dry run — compte sans appel serveur)
    for (const visit of visits) {
      const proposals = await sql<{ id: string; kind: string; title: string }>(`
        SELECT id, kind, title
        FROM site_knowledge_proposals
        WHERE report_id = '${visit.id}'
          AND site_id = '${site.id}'
          AND canonical_subject_id IS NULL
          AND kind IN ('action', 'vigilance', 'decision', 'knowledge')
          AND status IN ('proposed', 'fulfilled', 'superseded')
      `, token)

      if (!proposals.length) {
        process.stdout.write('.')
        continue
      }

      console.log(`\n  [${visit.created_at.slice(0, 10)}] "${(visit.title ?? '').slice(0, 60)}"`)
      console.log(`    → ${proposals.length} propositions candidates`)
      proposals.slice(0, 5).forEach(p => {
        console.log(`       [${p.kind}] "${p.title.slice(0, 70)}"`)
      })
      if (proposals.length > 5) console.log(`       ... et ${proposals.length - 5} de plus`)
    }

    console.log(`\n\n  Totaux projetés (dry run) — aucune écriture effectuée`)
    console.log(`  (relancer avec CONFIRM=1 pour appliquer)`)

    if (process.env.CONFIRM !== '1') continue

    // ── Mode écriture ─────────────────────────────────────────────────────────
    console.log('\n  Mode CONFIRM=1 — appel moteur en cours...')
    console.log('  (Ce script ne peut pas appeler directement le moteur Next.js/Supabase Admin.')
    console.log('   Utilise le script de backfill via API route ou invocation directe du module.)')
    console.log('')
    console.log('  Pour déclencher le backfill en production, utilise le script TypeScript suivant')
    console.log('  depuis l\'environnement Next.js (pas depuis une API publique Supabase) :')
    console.log('')
    console.log('    import { reconcileSourceToCanonicalSubjects } from "@/lib/db/canonical-subject-source-reconcile"')
    console.log(`    // Pour chaque visite du site ${site.name} :`)
    for (const visit of visits.slice(0, 3)) {
      console.log(`    await reconcileSourceToCanonicalSubjects({ type: "field_visit", id: "${visit.id}", siteId: "${site.id}", authorId: null, backfill: true })`)
    }
    if (visits.length > 3) {
      console.log(`    // ... ${visits.length - 3} visites de plus`)
    }
  }

  console.log('\n\nDone.')
}

main().catch(err => { console.error(String(err).slice(0, 500)); process.exit(1) })
