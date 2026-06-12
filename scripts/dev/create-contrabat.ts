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

const EMAIL = 'adrien.peres@memoria.nc'
const PASSWORD = 'memoria026'

async function main() {
  // 1. Créer l'organisation ContraBat
  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .insert({ name: 'ContraBat', slug: 'contrabat' })
    .select('id')
    .single()
  if (orgErr || !org) { console.error('org error:', orgErr); process.exit(1) }
  const orgId = org.id as string
  console.log(`✓ Organisation ContraBat créée : ${orgId}`)

  // 2. Créer l'utilisateur auth
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role: 'manager' },
  })
  if (authErr || !authData.user) { console.error('auth error:', authErr); process.exit(1) }
  const userId = authData.user.id
  console.log(`✓ Auth user créé : ${userId}`)

  // 3. Créer le profil dans users
  const { error: usersErr } = await sb.from('users').insert({
    id: userId,
    email: EMAIL,
    role: 'manager',
    organization_id: orgId,
  })
  if (usersErr) { console.error('users error:', usersErr); process.exit(1) }
  console.log(`✓ Profil users créé (org=ContraBat, role=manager)`)

  console.log('\nRécap :')
  console.log(`  Email    : ${EMAIL}`)
  console.log(`  Password : ${PASSWORD}`)
  console.log(`  Org      : ContraBat (${orgId})`)
  console.log(`  Espace   : vierge, isolé de BatiSud et AGP`)
}

main().catch(console.error)
