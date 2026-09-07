// Phase 6E.1C — application ciblée de la migration 392 via l'API Management
// (pattern _apply_migration_388/389/391.mjs), le tracker db:push étant drifté.
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
config({ path: '.env.local' })

const ref = process.env.NEXT_PUBLIC_SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)[1]
const API = `https://api.supabase.com/v1/projects/${ref}/database/query`
async function runQuery(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${await res.text()}`)
  return res.json()
}

const sql = readFileSync('supabase/migrations/392_merge_tracked_points_hardening.sql', 'utf8')
await runQuery(sql)
await runQuery(`insert into public._migrations_applied (filename) values ('392_merge_tracked_points_hardening.sql') on conflict do nothing;`)

const fns = await runQuery(`select proname, pronargs from pg_proc where proname in ('merge_tracked_points', 'reject_point_identity_pair') order by proname;`)
console.log('392 appliquée · fonctions =', JSON.stringify(fns))
