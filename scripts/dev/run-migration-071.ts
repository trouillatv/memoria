// Applique la migration 071 (planned_start/end — V6.1) via service-role key.
// Repli quand `npm run db:push` échoue (SUPABASE_ACCESS_TOKEN Management
// expiré). Idempotent : 071 = ADD COLUMN IF NOT EXISTS + backfill.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// .env.local n'est pas auto-chargé par tsx — on le lit comme scripts/db-push.ts
const ENV_PATH = '.env.local'
if (existsSync(ENV_PATH)) {
  for (const rawLine of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) {
  console.error('Variables NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requises')
  process.exit(1)
}

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/071_intervention_planned_start.sql'),
  'utf-8',
)

async function main() {
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // 1) RPC exec_sql via client JS (try/catch — le query-builder est thenable
  //    mais n'a pas .catch).
  let applied = false
  try {
    const { error } = await (supabase as any).rpc('exec_sql', { sql })
    if (!error) applied = true
  } catch {
    /* rpc absente — on tente le REST ci-dessous */
  }

  // 2) Repli REST direct.
  if (!applied) {
    const resp = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ sql }),
    })
    applied = resp.ok
    if (!resp.ok) {
      console.error(`exec_sql indisponible (HTTP ${resp.status}). Pas de chemin DDL programmatique.`)
      console.log('\n→ Applique 071 via Supabase SQL Editor (idempotent, additif) :')
      console.log('  supabase/migrations/071_intervention_planned_start.sql')
      process.exit(1)
    }
  }
  console.log('✓ Migration 071 appliquée (planned_start/end).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
