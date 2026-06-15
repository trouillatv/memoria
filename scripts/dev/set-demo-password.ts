// Met le mot de passe de demo@memoria.nc à `memoria2026` ET neutralise le flag
// de changement forcé au démarrage (must_change_password) aux DEUX sources de
// vérité : `app_metadata.must_change_password` (lu par le middleware/proxy à
// chaque requête) ET la colonne `public.users.must_change_password`.
//
// À lancer en local, avec un .env.local valide (URL Supabase + SERVICE ROLE) :
//   npx tsx scripts/dev/set-demo-password.ts
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

const EMAIL = 'demo@memoria.nc'
const NEW_PASSWORD = 'memoria2026'

async function main() {
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 200 })
  if (listErr) { console.error(listErr); process.exit(1) }
  const user = list?.users?.find((u) => u.email === EMAIL)
  if (!user) { console.error(`User ${EMAIL} introuvable`); process.exit(1) }

  // Mot de passe + neutralisation du flag dans app_metadata (lu par le middleware).
  // ⚠️ Supabase MERGE app_metadata : on met explicitement `false`, on ne supprime
  // pas la clé (delete ne propage pas). Le middleware teste `=== true`.
  const { error: updErr } = await sb.auth.admin.updateUserById(user.id, {
    password: NEW_PASSWORD,
    app_metadata: { must_change_password: false },
  })
  if (updErr) { console.error(updErr); process.exit(1) }

  // Seconde source de vérité : la colonne en DB.
  const { error: dbErr } = await sb
    .from('users')
    .update({ must_change_password: false })
    .eq('id', user.id)
  if (dbErr) { console.error(dbErr); process.exit(1) }

  console.log(`✓ ${EMAIL} : mot de passe = "${NEW_PASSWORD}", must_change_password = false (app_metadata + DB)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
