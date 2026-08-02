/**
 * Lot 1 — Seed canonical_subject + subject_thread_identity (backfill 1:1)
 *
 * Pour chaque subject_thread_id distinct dans document_extraction_proposal :
 *  1. Crée un canonical_subject (label = label de la proposition la plus récente du thread)
 *  2. Crée un subject_thread_identity avec source='auto'
 *
 * Idempotent : les threads déjà présents dans subject_thread_identity sont ignorés.
 *
 * Usage :
 *   npx tsx scripts/seed-canonical-subject.ts              # tous les sites
 *   npx tsx scripts/seed-canonical-subject.ts --dry-run    # aperçu sans écriture
 *   npx tsx scripts/seed-canonical-subject.ts --site-id <uuid>   # site unique
 */

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

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text)
}

type ThreadRow = {
  site_id: string
  subject_thread_id: string
  latest_label: string
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const siteArgIdx = process.argv.indexOf('--site-id')
  const siteFilter = siteArgIdx !== -1 ? process.argv[siteArgIdx + 1] : null

  // target_site_id est sur document_extraction_run, pas sur document_extraction_proposal
  const siteClause = siteFilter ? `AND der.target_site_id = '${siteFilter}'` : ''

  console.log(`Mode : ${dryRun ? 'DRY-RUN (aucune écriture)' : 'ÉCRITURE'}`)
  if (siteFilter) console.log(`Site  : ${siteFilter}`)
  console.log()

  // Récupère tous les threads non encore indexés, avec le label le plus récent
  const threads = await sql(`
    SELECT DISTINCT ON (der.target_site_id, dep.subject_thread_id)
      der.target_site_id   AS site_id,
      dep.subject_thread_id,
      dep.label            AS latest_label
    FROM document_extraction_proposal dep
    JOIN document_extraction_run der ON der.id = dep.extraction_run_id
    LEFT JOIN documents d ON d.id = der.document_id
    WHERE dep.subject_thread_id IS NOT NULL
      AND der.target_site_id IS NOT NULL
      AND dep.label IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM subject_thread_identity sti
        WHERE sti.subject_thread_id = dep.subject_thread_id
      )
      ${siteClause}
    ORDER BY
      der.target_site_id,
      dep.subject_thread_id,
      COALESCE(d.effective_date, '1970-01-01') DESC,
      der.created_at DESC
  `) as ThreadRow[]

  console.log(`Threads à seeder : ${threads.length}`)

  if (threads.length === 0) {
    console.log('[OK] Rien à faire — tous les threads sont déjà indexés.')
    return
  }

  // Aperçu par site
  const bySite = new Map<string, number>()
  for (const t of threads) bySite.set(t.site_id, (bySite.get(t.site_id) ?? 0) + 1)
  for (const [siteId, count] of bySite) {
    console.log(`  site ${siteId.slice(0, 8)}… → ${count} thread(s)`)
  }
  console.log()

  if (dryRun) {
    console.log('DRY-RUN : relancez sans --dry-run pour appliquer.')
    return
  }

  // Exécution via DO block pour préserver la liaison thread_id → canonical_subject_id
  // sans passer par N requêtes séquentielles
  const values = threads
    .map(t => `('${t.site_id}', '${t.subject_thread_id}', '${escapeSql(t.latest_label)}')`)
    .join(',\n    ')

  await sql(`
    DO $$
    DECLARE
      rec    RECORD;
      cs_id  UUID;
    BEGIN
      FOR rec IN (
        SELECT *
        FROM (VALUES
          ${values}
        ) AS v(site_id, subject_thread_id, label)
      )
      LOOP
        -- Crée canonical_subject
        INSERT INTO canonical_subject (site_id, label)
        VALUES (rec.site_id::uuid, rec.label)
        RETURNING id INTO cs_id;

        -- Lie le thread au canonical_subject
        INSERT INTO subject_thread_identity (subject_thread_id, site_id, canonical_subject_id, source)
        VALUES (rec.subject_thread_id::uuid, rec.site_id::uuid, cs_id, 'auto')
        ON CONFLICT (subject_thread_id) DO NOTHING;
      END LOOP;
    END;
    $$;
  `)

  // Vérification post-seed
  const after = await sql(`
    SELECT
      (SELECT COUNT(*) FROM canonical_subject ${siteFilter ? `WHERE site_id = '${siteFilter}'` : ''}) AS cs_cnt,
      (SELECT COUNT(*) FROM subject_thread_identity ${siteFilter ? `WHERE site_id = '${siteFilter}'` : ''}) AS sti_cnt
  `) as Array<{ cs_cnt: string; sti_cnt: string }>

  console.log(`[OK] Seed terminé.`)
  console.log(`  canonical_subject    : ${after[0].cs_cnt}`)
  console.log(`  subject_thread_identity : ${after[0].sti_cnt}`)
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''").slice(0, 500)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
