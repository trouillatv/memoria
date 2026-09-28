// Application ciblée de la migration 447 (pattern _apply_migration_446.mjs) —
// DOC-CONTRACT-OS-1B1 2e fix de fermeture : garde multi-organisation
// fail-closed (proposition/document/chantier/Engagement cible) pour TOUS les
// effets, y compris NEW (mandat Vincent 2026-09-28, 2e revue ChatGPT).
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

const sql = readFileSync('supabase/migrations/447_doc_contract_os_1b1_fix_multiorg_failclosed.sql', 'utf8')
await runQuery(sql)
await runQuery(`insert into public._migrations_applied (filename) values ('447_doc_contract_os_1b1_fix_multiorg_failclosed.sql') on conflict do nothing;`)
await runQuery(`notify pgrst, 'reload schema';`)
console.log('447 appliquée')

const src = await runQuery(`
  select prosrc from pg_proc where proname = 'materialize_engagement_contract_effect';
`)
const body = src?.[0]?.prosrc ?? ''
console.log('contient garde proposition org =', body.includes('rec.organization_id IS DISTINCT FROM v_org_id'))
console.log('contient garde document org =', body.includes('v_document_org_id IS DISTINCT FROM v_org_id'))
