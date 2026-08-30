// Application de la migration 373 via Supabase Management API
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

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/373_attention_signal_acknowledgements.sql'), 'utf-8')
  console.log('Application migration 373...')
  const result = await query(projectRef, token, sql)
  console.log('OK', result)

  console.log('\nVérification table...')
  const check = await query(
    projectRef,
    token,
    `select indexname, indexdef from pg_indexes where tablename = 'attention_signal_acknowledgements'`,
  )
  console.log(check)
}

main().catch((e) => { console.error(e); process.exit(1) })
