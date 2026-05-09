/**
 * Script lancé manuellement (ou via npm run db:bootstrap-admin) pour créer
 * l'utilisateur admin initial après la première migration de la DB.
 *
 * Lit INITIAL_ADMIN_EMAIL et INITIAL_ADMIN_PASSWORD depuis l'env (.env.local).
 * Idempotent : ne fait rien si l'admin existe déjà.
 *
 * Le trigger handle_new_auth_user crée automatiquement la row public.users
 * avec role 'chef_equipe' par défaut. On la met à jour ensuite à role='admin'
 * et must_change_password=true.
 */
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
// Node 20 lacks native WebSocket — provide ws as transport.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const email = process.env.INITIAL_ADMIN_EMAIL
  const password = process.env.INITIAL_ADMIN_PASSWORD

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  if (!email || !password) {
    throw new Error('Missing INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // @ts-ignore — ws types don't align with WebSocketLikeConstructor on Node 20
    realtime: { transport: ws },
  })

  // Existe déjà ?
  const { data: existing } = await supabase.auth.admin.listUsers()
  const found = existing?.users?.find((u) => u.email === email)
  if (found) {
    console.log(`[bootstrap-admin] Admin ${email} already exists (id=${found.id}). Skipping.`)
    return
  }

  // Créer
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { full_name: 'Admin', role: 'admin' },
  })
  if (error) throw error
  if (!data.user) throw new Error('No user returned')

  // Le trigger on_auth_user_created devrait avoir créé public.users.
  // On force le rôle admin et must_change_password=true.
  const { error: updateError } = await supabase
    .from('users')
    .update({ role: 'admin', must_change_password: true, full_name: 'Admin' })
    .eq('id', data.user.id)
  if (updateError) throw updateError

  console.log(`[bootstrap-admin] Admin created: ${email} (id=${data.user.id})`)
  console.log('Mot de passe temporaire = INITIAL_ADMIN_PASSWORD ; il devra être changé à la première connexion.')
}

main().catch((e) => {
  console.error('[bootstrap-admin] failed:', e)
  process.exit(1)
})
