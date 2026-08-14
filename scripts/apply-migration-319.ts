// Application de la migration 319 via l'API Supabase Management
// superseded_by/superseded_at sur site_actions, site_decisions, site_watchpoints
// (P0-2ter — capacité de remplacement, purement additif)

import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

config({ path: '.env.local' })

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = 'srixnofmaydxouhucawn'

async function query(sql: string, label: string) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    }
  )
  if (!response.ok) {
    const text = await response.text()
    console.error(`❌ ${label} : ${response.status} ${response.statusText}`)
    console.error(text)
    process.exit(1)
  }
  return response.json()
}

async function main() {
  if (!ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }

  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/319_superseded_by_lifecycle.sql'), 'utf-8')
  console.log('📄 Migration 319 — superseded_by lifecycle (actions/décisions/vigilances)')

  await query(sql, 'Migration')
  console.log('✅ Migration appliquée')

  const checks = await query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('superseded_by', 'superseded_at')
      and table_name in ('site_actions', 'site_decisions', 'site_watchpoints')
    order by table_name, column_name
  `, 'Vérification')
  console.log('Colonnes présentes :')
  for (const row of checks as Array<{ table_name: string; column_name: string }>) {
    console.log(`  · ${row.table_name}.${row.column_name}`)
  }
}

main()
