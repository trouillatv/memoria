// Application de la migration 276 via Supabase Management API

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

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/276_extraction_run_is_canonical.sql'), 'utf-8')

  console.log('[276] Applying migration...')
  try {
    await query(sql)
    console.log('[276] Migration applied')

    // Vérification backfill
    const rows = await query(`
      SELECT
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE is_canonical = true) AS canonical_runs,
        COUNT(DISTINCT document_id) FILTER (WHERE is_canonical = true) AS canonical_docs
      FROM public.document_extraction_run
      WHERE status = 'ready_for_review';
    `) as Array<{ total_runs: string; canonical_runs: string; canonical_docs: string }>
    const r = rows[0]
    console.log(`[276] Runs ready_for_review: ${r.total_runs} | Canoniques: ${r.canonical_runs} | Documents distincts: ${r.canonical_docs}`)

    // Vérifier PV001 spécifiquement
    const pv001 = await query(`
      SELECT id, status, is_canonical, created_at,
        (SELECT COUNT(*) FROM document_extraction_proposal p WHERE p.extraction_run_id = r.id) AS nb
      FROM document_extraction_run r
      WHERE r.document_id = '64cf7623-872c-4e52-b216-42db3deefb2d'
      ORDER BY created_at;
    `) as Array<{ id: string; status: string; is_canonical: boolean; created_at: string; nb: string }>
    console.log('[276] Runs PV001 (64cf7623):')
    for (const r of pv001) console.log(`  ${r.id.slice(0,8)} canonical=${r.is_canonical} props=${r.nb} ${r.created_at.slice(0,19)}`)

    console.log('[276] SUCCESS')
  } catch (err) {
    console.error('[276] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
