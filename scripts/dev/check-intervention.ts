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

;(async () => {
  // 1) Interventions demain (15 mai 2026)
  console.log('=== Interventions du 2026-05-15 ===')
  const tomorrow = await q(
    `select id, status, slot, assigned_team_id, team
     from interventions
     where scheduled_for = '2026-05-15'
     order by slot;`,
  )
  console.log(tomorrow)

  // 2) Équipe Nouméa Centre — membres actifs
  console.log('\n=== Membres actifs équipe Nouméa Centre ===')
  const members = await q(
    `select tm.user_id, u.full_name, u.email, u.role
     from team_members tm
     join teams t on t.id = tm.team_id
     join users u on u.id = tm.user_id
     where t.name ilike '%Nouméa Centre%'
       and tm.left_at is null
       and u.deleted_at is null;`,
  )
  console.log(members)

  // 3) Sofia Demo : ses team_members
  console.log('\n=== Sofia Demo — appartenances équipe ===')
  const sofia = await q(
    `select u.id, u.full_name, u.role, t.name as team_name, tm.left_at
     from users u
     left join team_members tm on tm.user_id = u.id
     left join teams t on t.id = tm.team_id
     where u.full_name ilike '%Sofia%';`,
  )
  console.log(sofia)
})().catch((e) => { console.error(e); process.exit(1) })
