/**
 * Application de la migration 331 via l'API Management Supabase.
 * copilot_proposal_id sur site_watchpoints + intent CREATE_WATCHPOINT (P4-E1).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import * as fs from 'node:fs'

const PROJECT_REF = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/([^.]+)\.supabase\.co/)![1]
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

async function query(q: string, label = ''): Promise<unknown> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} [${label}]: ${text}`)
  return JSON.parse(text)
}

const migrationSQL = fs.readFileSync('supabase/migrations/331_site_watchpoints_copilot_proposal.sql', 'utf8')

async function main() {
  console.log(`Project: ${PROJECT_REF}`)
  console.log('Application de la migration 331...\n')
  await query(migrationSQL, 'migration-331')
  console.log('Migration appliquée.\n')

  const col = await query(`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'site_watchpoints' and column_name = 'copilot_proposal_id';
  `, 'verify-column')
  console.log('Colonne vérifiée :', JSON.stringify(col, null, 2))

  const check = await query(`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conname = 'copilot_proposal_kind_chk';
  `, 'verify-constraint')
  console.log('Contrainte vérifiée :', JSON.stringify(check, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
