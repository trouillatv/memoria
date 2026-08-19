// Application de la migration 342 via Supabase Management API (HTTPS)

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

async function query(projectRef: string, token: string, sql: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
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
  const projectRef = 'srixnofmaydxouhucawn'
  if (!token) { console.error('SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/342_similarity_analysis_status.sql'), 'utf-8')

  console.log('[342] Applying via Supabase Management API...')
  try {
    await query(projectRef, token, sql)
    console.log('[342] Migration applied')

    const rows = await query(projectRef, token, `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'site_reports'
        AND column_name LIKE 'similarity_analysis_%'
      ORDER BY column_name;
    `) as Array<{ column_name: string }>
    console.log(`[342] Colonnes: ${rows.map((r) => r.column_name).join(', ')}`)

    await query(projectRef, token, "NOTIFY pgrst, 'reload schema';")
    console.log('[342] Schema reloaded')
    console.log('[342] SUCCESS')
  } catch (err) {
    console.error('[342] FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
