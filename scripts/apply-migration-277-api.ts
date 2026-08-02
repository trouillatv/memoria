// Application de la migration 277 via Supabase Management API

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

async function query(sql: string): Promise<unknown> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/277_extraction_run_canonical_constraint.sql'), 'utf-8')

  console.log('[277] Applying unique partial index...')
  try {
    await query(sql)
    console.log('[277] Index created')

    // Vérifier que l'index existe
    const rows = await query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'document_extraction_run'
        AND indexname = 'idx_extraction_run_one_canonical_per_doc';
    `) as Array<{ indexname: string; indexdef: string }>
    if (rows.length === 0) throw new Error('Index non trouvé après création')
    console.log(`[277] Index vérifié : ${rows[0].indexdef}`)

    // Vérifier qu'aucun document n'a deux canoniques (l'index aurait bloqué la création sinon)
    const dupes = await query(`
      SELECT document_id, COUNT(*) AS nb
      FROM document_extraction_run
      WHERE is_canonical = true
      GROUP BY document_id
      HAVING COUNT(*) > 1;
    `) as unknown[]
    if (dupes.length > 0) throw new Error(`${dupes.length} document(s) avec plusieurs canoniques — incohérence`)
    console.log('[277] Unicité vérifiée : aucun doublon canonique')

    console.log('[277] SUCCESS')
  } catch (err) {
    console.error('[277] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
