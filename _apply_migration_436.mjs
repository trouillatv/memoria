// Application ciblée de la migration 436 (pattern _apply_migration_435.mjs) —
// tender_id nullable + site_id/source_document_id + famille 'engagement' +
// materialize_engagement_create_new/link_existing, P0-2A réalignement
// (mandat Vincent 2026-09-24).
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

const sql = readFileSync('supabase/migrations/436_engagement_direct_document_circuit.sql', 'utf8')
await runQuery(sql)
await runQuery(`insert into public._migrations_applied (filename) values ('436_engagement_direct_document_circuit.sql') on conflict do nothing;`)
await runQuery(`notify pgrst, 'reload schema';`)
console.log('436 appliquée')

const columns = await runQuery(`
  select column_name, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='engagements'
    and column_name in ('tender_id','site_id','source_document_id')
  order by column_name;
`)
console.log('colonnes engagements =', JSON.stringify(columns, null, 2))

const checks = await runQuery(`
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.engagements'::regclass and contype='c'
  order by conname;
`)
console.log('CHECK engagements =', JSON.stringify(checks, null, 2))

const familyCheck = await runQuery(`
  select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conname = 'document_extraction_proposal_proposal_family_check';
`)
console.log('CHECK proposal_family =', JSON.stringify(familyCheck, null, 2))

const fnCheck = await runQuery(`
  select p.proname, p.prosecdef
  from pg_proc p
  where p.proname in ('materialize_engagement_create_new', 'materialize_engagement_link_existing')
  order by p.proname;
`)
console.log('fonctions créées =', JSON.stringify(fnCheck, null, 2))

const trigCheck = await runQuery(`
  select tgname from pg_trigger
  where tgrelid = 'public.documents'::regclass and not tgisinternal;
`)
console.log('triggers documents =', JSON.stringify(trigCheck, null, 2))
