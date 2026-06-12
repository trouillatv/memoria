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

const EMAIL = 'adrien@memoria.nc'
const NEW_PASSWORD = 'memoria2026'

async function main() {
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 })
  const user = list?.users?.find((u) => u.email === EMAIL)
  if (!user) { console.error(`User ${EMAIL} not found`); process.exit(1) }

  const { error } = await sb.auth.admin.updateUserById(user.id, { password: NEW_PASSWORD })
  if (error) { console.error(error); process.exit(1) }
  console.log(`✓ Mot de passe de ${EMAIL} mis à jour`)
}

main().catch(console.error)
