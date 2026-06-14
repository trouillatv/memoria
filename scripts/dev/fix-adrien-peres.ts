import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const CONTRABAT_ORG_ID = '6075483d-62f0-4e72-b030-4b1752ef59b4'
const EMAIL = 'adrien.peres@memoria.nc'

async function main() {
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 })
  const user = list?.users?.find((u) => u.email === EMAIL)
  if (!user) { console.error('User not found'); process.exit(1) }

  // Update app_metadata
  await sb.auth.admin.updateUserById(user.id, { app_metadata: { role: 'manager' } })

  // Update users table
  const { error } = await sb.from('users')
    .update({ role: 'manager', organization_id: CONTRABAT_ORG_ID, home_preference: 'terrain' })
    .eq('id', user.id)
  if (error) { console.error(error); process.exit(1) }

  // Verify
  const { data: all } = await sb.from('users').select('email, role, organization_id, home_preference').is('deleted_at', null)
  const orgs: Record<string, string> = {
    '3a666557-a84e-4d4b-a7f8-9bb4a48acfec': 'BatiSud',
    '9862b3b2-b564-4f41-8b04-36a753d7442e': 'AGP',
    '6075483d-62f0-4e72-b030-4b1752ef59b4': 'ContraBat',
  }
  console.log('\n=== État des comptes ===')
  for (const u of all ?? []) {
    const org = orgs[u.organization_id] ?? u.organization_id ?? 'NULL'
    console.log(`  ${u.email} | ${u.role} | ${org} | accueil=${u.home_preference}`)
  }
}

main().catch(console.error)
