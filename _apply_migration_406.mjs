// Lot Entreprise citée → Responsable — application ciblée de la migration 406 via l'API
// Management (pattern _apply_migration_388/389/404/405.mjs, le tracker db:push étant drifté).
// Additive uniquement : 1 nouvelle table (tracked_point_responsible_companies), aucune donnée
// existante touchée, aucune surface applicative ne la consomme encore avant ce lot.
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

console.log('project_ref =', ref)

const sql = readFileSync('supabase/migrations/406_tracked_point_responsible_companies.sql', 'utf8')
await runQuery(sql)
await runQuery(`insert into public._migrations_applied (filename) values ('406_tracked_point_responsible_companies.sql') on conflict do nothing;`)
console.log('406 appliquée (table créée + tracker _migrations_applied mis à jour)')

const table = await runQuery(`select table_name from information_schema.tables where table_schema='public' and table_name='tracked_point_responsible_companies';`)
console.log('table présente =', JSON.stringify(table))

const cols = await runQuery(`
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='tracked_point_responsible_companies'
  order by ordinal_position;
`)
console.log('colonnes =', JSON.stringify(cols))

const fks = await runQuery(`
  select
    tc.constraint_name, kcu.column_name, ccu.table_name as references_table, rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
  where tc.table_schema='public' and tc.table_name='tracked_point_responsible_companies' and tc.constraint_type='FOREIGN KEY'
  order by kcu.column_name;
`)
console.log('FK =', JSON.stringify(fks))

const indexes = await runQuery(`
  select indexname, indexdef
  from pg_indexes
  where schemaname='public' and tablename='tracked_point_responsible_companies'
  order by indexname;
`)
console.log('index =', JSON.stringify(indexes))

const rls = await runQuery(`
  select relrowsecurity, relforcerowsecurity
  from pg_class
  where relname='tracked_point_responsible_companies' and relnamespace = 'public'::regnamespace;
`)
console.log('RLS activé =', JSON.stringify(rls))

const policies = await runQuery(`
  select policyname, permissive, roles, cmd, qual
  from pg_policies
  where schemaname='public' and tablename='tracked_point_responsible_companies'
  order by policyname;
`)
console.log('policies =', JSON.stringify(policies))

const rowCount = await runQuery(`select count(*) as n from public.tracked_point_responsible_companies;`)
console.log('lignes (doit être 0) =', JSON.stringify(rowCount))

const untouched = await runQuery(`
  select
    (select count(*) from public.tracked_point) as tracked_point,
    (select count(*) from public.canonical_subject) as canonical_subject,
    (select count(*) from public.companies) as companies;
`)
console.log('compteurs read-models existants (doivent être inchangés) =', JSON.stringify(untouched))
