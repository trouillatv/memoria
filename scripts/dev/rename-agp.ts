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

async function main() {
  const { error } = await sb
    .from('organizations')
    .update({ name: 'AGP', slug: 'agp' })
    .eq('id', MVO_ORG_ID)
  if (error) { console.error(error); process.exit(1) }
  console.log('✓ Organisation renommée AGP')
}

main().catch(console.error)
