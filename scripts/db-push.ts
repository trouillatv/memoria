/**
 * scripts/db-push.ts
 *
 * Applies pending SQL migrations from supabase/migrations/*.sql to the linked
 * Supabase Cloud project via the Supabase Management API.
 *
 * - Auth: SUPABASE_ACCESS_TOKEN (loaded from .env.local).
 * - Project ref: extracted from NEXT_PUBLIC_SUPABASE_URL.
 * - Tracking: a `public._migrations_applied` table stores the list of applied
 *   migration filenames, ordered by execution. Idempotent : already-applied
 *   migrations are skipped.
 *
 * Usage : `npm run db:push`
 */
import * as fs from 'fs'
import * as path from 'path'
import 'dotenv/config'

const ENV_PATH = '.env.local'
function loadEnvLocal() {
  // dotenv/config loads .env by default. We want .env.local.
  if (!fs.existsSync(ENV_PATH)) return
  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  for (const rawLine of raw.split('\n')) {
    // Windows CRLF safe : retirer \r de fin (sinon `(.*)$` ne match pas)
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!ACCESS_TOKEN) throw new Error('Missing SUPABASE_ACCESS_TOKEN in .env.local')
if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')

const projectRefMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)
if (!projectRefMatch) throw new Error(`Cannot extract project ref from ${SUPABASE_URL}`)
const PROJECT_REF = projectRefMatch[1]

const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

async function runQuery(sql: string): Promise<unknown[]> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase API ${res.status}: ${text}`)
  }
  return res.json()
}

async function ensureMigrationsTable() {
  await runQuery(`
    create table if not exists public._migrations_applied (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `)
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await runQuery(`select filename from public._migrations_applied order by filename;`)
  // rows is an array of objects { filename: '...' }
  return new Set((rows as Array<{ filename: string }>).map((r) => r.filename))
}

async function main() {
  console.log(`[db-push] Project ref: ${PROJECT_REF}`)
  console.log(`[db-push] Ensuring migrations tracker exists...`)
  await ensureMigrationsTable()
  const applied = await getAppliedMigrations()
  console.log(`[db-push] Already applied: ${applied.size} migration(s)`)

  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.log('[db-push] No supabase/migrations/ directory. Nothing to push.')
    return
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    console.log('[db-push] No .sql files found in supabase/migrations/. Nothing to push.')
    return
  }

  let appliedCount = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[db-push] Skip (already applied): ${file}`)
      continue
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim()
    if (!sql) {
      console.log(`[db-push] Skip (empty): ${file}`)
      continue
    }
    console.log(`[db-push] Applying ${file}...`)
    try {
      await runQuery(sql)
      // Record in tracker (use parameterized-style — but Management API doesn't support params, so escape manually)
      const safeName = file.replace(/'/g, "''")
      await runQuery(`insert into public._migrations_applied (filename) values ('${safeName}') on conflict do nothing;`)
      appliedCount++
      console.log(`[db-push] ✓ ${file}`)
    } catch (e) {
      console.error(`[db-push] ✗ ${file}:`, e)
      process.exit(1)
    }
  }

  console.log(`[db-push] Done. Applied ${appliedCount} new migration(s). Total tracked: ${applied.size + appliedCount}.`)
}

main().catch((e) => {
  console.error('[db-push] Fatal:', e)
  process.exit(1)
})
