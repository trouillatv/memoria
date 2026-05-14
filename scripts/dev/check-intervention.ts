import * as fs from 'fs'
import 'dotenv/config'

function loadEnvLocal() {
  if (!fs.existsSync('.env.local')) return
  for (const rawLine of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!ACCESS_TOKEN || !SUPABASE_URL) throw new Error('Missing env')
const REF = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)![1]

async function q(sql: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

const id = 'f2a88d0b-522a-404a-afc7-718e52454a45'
;(async () => {
  const rows = await q(
    `select i.id, i.status, i.scheduled_for, i.slot, i.assigned_team_id,
            t.name as team_name, t.color as team_color
     from interventions i
     left join teams t on t.id = i.assigned_team_id
     where i.id = '${id}';`,
  )
  console.log(rows)
})().catch((e) => { console.error(e); process.exit(1) })
