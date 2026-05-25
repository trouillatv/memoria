/**
 * scripts/dev/_supabase-discover.ts — LECTURE SEULE.
 * Liste les organisations + projets Supabase via la Management API.
 * N'imprime AUCUN secret (ni clés ni token). Sert à préparer la base de test.
 *
 * USAGE : npm exec tsx scripts/dev/_supabase-discover.ts
 */
import * as fs from 'fs'

function loadEnvLocal() {
  const p = '.env.local'
  if (!fs.existsSync(p)) return
  for (const rawLine of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) throw new Error('Missing SUPABASE_ACCESS_TOKEN in .env.local')

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function main() {
  const orgs = await api<Array<{ id: string; name: string; plan?: string }>>('/organizations')
  console.log('\n=== Organisations ===')
  for (const o of orgs) console.log(`  ${o.name}  [id ${o.id}]  plan=${o.plan ?? '?'}`)

  const projects = await api<Array<{ id: string; name: string; region: string; organization_id: string; status: string }>>('/projects')
  console.log(`\n=== Projets (${projects.length}) ===`)
  for (const p of projects) {
    console.log(`  ${p.name.padEnd(22)} region=${p.region.padEnd(14)} status=${p.status}  org=${p.organization_id}  ref=${p.id}`)
  }
  console.log('\n(LECTURE SEULE — aucun secret imprimé.)')
}

main().catch((e) => { console.error('[discover] failed:', e.message ?? e); process.exit(1) })
