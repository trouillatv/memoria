/**
 * Restore Guillaume's role to 'manager' and ensure he's in MVO org.
 * USAGE: npx tsx scripts/dev/fix-guillaume-role.ts
 */
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

const MVO_ORG_ID = '9862b3b2-b564-4f41-8b04-36a753d7442e'
const GUILLAUME_EMAIL = 'guillaume.demene@memoria.nc'

async function main() {
  // Find Guillaume's auth user
  const { data: authList } = await sb.auth.admin.listUsers({ perPage: 200 })
  const authUser = authList?.users?.find((u) => u.email === GUILLAUME_EMAIL)
  if (!authUser) {
    console.error(`User ${GUILLAUME_EMAIL} not found in auth`)
    process.exit(1)
  }
  const guillaumeId = authUser.id
  console.log(`Found Guillaume: ${guillaumeId}`)

  // Update auth metadata to manager
  const { error: authErr } = await sb.auth.admin.updateUserById(guillaumeId, {
    app_metadata: { role: 'manager' },
  })
  if (authErr) console.error('auth meta update error:', authErr)
  else console.log('✓ auth app_metadata.role = manager')

  // Update users table
  const { error: usersErr } = await sb.from('users')
    .update({ role: 'manager', organization_id: MVO_ORG_ID })
    .eq('id', guillaumeId)
  if (usersErr) console.error('users update error:', usersErr)
  else console.log('✓ users.role = manager, users.organization_id = MVO')

  console.log('Done.')
}

main().catch(console.error)
