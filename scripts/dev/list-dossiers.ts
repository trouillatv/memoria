// Liste les dossiers existants (id + label + phase + site) pour obtenir une vraie
// URL /dossiers/[id] à tester. Lecture seule. Usage : npx tsx scripts/dev/list-dossiers.ts
import * as fs from 'fs'
import 'dotenv/config'

if (fs.existsSync('.env.local')) {
  for (const rawLine of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ACCESS_TOKEN || !ref) throw new Error('Missing SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL')

async function q(sql: string): Promise<unknown[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const rows = await q(`
    select d.id, d.label, d.phase, s.name as site_name, c.name as client_name, d.created_at
    from public.dossiers d
    left join public.sites s on s.id = d.site_id
    left join public.clients c on c.id = d.client_id
    where d.deleted_at is null
    order by d.created_at desc
    limit 20
  `)
  if (rows.length === 0) {
    console.log('(aucun dossier — créez-en un via /opportunites)')
    return
  }
  for (const r of rows as Array<{ id: string; label: string | null; phase: string; site_name: string | null; client_name: string | null }>) {
    console.log(`/dossiers/${r.id}  ·  ${r.label ?? r.site_name ?? '—'}  ·  ${r.phase}  ·  ${r.client_name ?? ''}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
