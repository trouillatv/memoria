// Application des migrations 320 (P0-3A participation) + 321 (P0-3B affiliations)
// via l'API Supabase Management. Conception Vincent 2026-08-14.

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

  for (const file of ['320_intervenant_participation.sql', '321_contact_company_affiliations.sql']) {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf-8')
    console.log(`📄 ${file}`)
    await query(sql, file)
    console.log('  ✅ appliquée')
  }

  const cols = await query(`
    select table_name, column_name, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'site_intervenants' and column_name in ('company_id', 'replaced_by_intervenant_id', 'replaced_at'))
        or (table_name = 'contact_company_affiliations'))
    order by table_name, column_name
  `, 'Vérification colonnes')
  console.log('\nColonnes :')
  for (const r of cols as Array<{ table_name: string; column_name: string; is_nullable: string }>) {
    console.log(`  · ${r.table_name}.${r.column_name} (nullable=${r.is_nullable})`)
  }

  const counts = await query(`
    select
      (select count(*) from public.contact_company_affiliations) as affiliations,
      (select count(*) from public.company_contacts where company_id is not null and deleted_at is null) as contacts_avec_entreprise
  `, 'Vérification backfill')
  console.log(`\nBackfill : ${JSON.stringify((counts as unknown[])[0])}`)

  const uniq = await query(`
    select indexname from pg_indexes
    where schemaname = 'public'
      and indexname in ('site_intervenants_active_identity_uniq', 'contact_company_affiliations_active_uniq')
  `, 'Vérification index')
  console.log(`Index partiels : ${(uniq as Array<{ indexname: string }>).map((r) => r.indexname).join(' · ')}`)
}

main()
