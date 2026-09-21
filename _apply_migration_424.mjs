// Lot Taille de photo CR (cr_photo_size) — application ciblée de la migration 424 via
// l'API Management (pattern _apply_migration_388/389/404/405/406.mjs, tracker db:push
// drifté). Additive uniquement : 1 colonne nullable + check constraint, aucune donnée
// existante touchée, aucun backfill.
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

const sql = readFileSync('supabase/migrations/424_visit_capture_cr_photo_size.sql', 'utf8')
await runQuery(sql)
await runQuery(`insert into public._migrations_applied (filename) values ('424_visit_capture_cr_photo_size.sql') on conflict do nothing;`)
await runQuery(`notify pgrst, 'reload schema';`)
console.log('424 appliquée (colonne cr_photo_size + check constraint + tracker + reload PostgREST)')

const cols = await runQuery(`
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='visit_capture' and column_name='cr_photo_size';
`)
console.log('colonne =', JSON.stringify(cols))

const constraint = await runQuery(`
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conname = 'visit_capture_cr_photo_size_check';
`)
console.log('constraint =', JSON.stringify(constraint))

const untouched = await runQuery(`
  select
    (select count(*) from public.visit_capture) as visit_capture_total,
    (select count(*) from public.visit_capture where cr_photo_size is not null) as cr_photo_size_non_null;
`)
console.log('compteurs (cr_photo_size_non_null doit être 0) =', JSON.stringify(untouched))
