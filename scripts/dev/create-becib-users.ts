/**
 * Crée les comptes pilote BECIB : Guillaume + Émeline.
 * Idempotent : ne recrée pas un compte déjà existant.
 *
 * Reprend le flux admin (app/admin/users/actions.ts) :
 *   - auth.admin.createUser + mot de passe temporaire partagé `memoria2026`
 *   - must_change_password=true (changement forcé à la 1re connexion)
 *   - rôle 'manager' (bureau : sites/réunions/PV/actions ; ni admin ni terrain)
 *   - rattache l'org BECIB si elle existe (sinon laisse null et le signale)
 *
 * Lancement : npx tsx scripts/dev/create-becib-users.ts
 */
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const ws = require('ws')

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const TEMP_PASSWORD = 'memoria2026'

const USERS = [
  { email: 'guillaume.devallez@memoria.nc', full_name: 'Guillaume Devallez' },
  { email: 'emeline.devallez@memoria.nc', full_name: 'Émeline Devallez' },
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // @ts-ignore — ws types don't align with WebSocketLikeConstructor on Node 20
    realtime: { transport: ws },
  })

  // Org BECIB ?
  let becibOrgId: string | null = null
  const { data: orgs } = await supabase.from('organizations').select('id, name').ilike('name', '%becib%')
  if (orgs && orgs.length === 1) becibOrgId = (orgs[0] as { id: string }).id
  console.log(orgs && orgs.length
    ? `[becib] org trouvée : ${orgs.map((o: { name: string }) => o.name).join(', ')}${becibOrgId ? '' : ' (ambigu → org laissée vide)'}`
    : '[becib] aucune org « BECIB » → comptes créés sans org (à rattacher dans /admin)')

  // Tous les comptes auth existants (pour l'idempotence).
  const { data: existing } = await supabase.auth.admin.listUsers()
  const byEmail = new Map((existing?.users ?? []).map((u) => [u.email, u]))

  for (const u of USERS) {
    let userId: string
    const found = byEmail.get(u.email)
    if (found) {
      console.log(`[skip] ${u.email} existe déjà (id=${found.id})`)
      userId = found.id
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: TEMP_PASSWORD,
        email_confirm: true,
        app_metadata: { role: 'manager', must_change_password: true },
        user_metadata: { full_name: u.full_name, role: 'manager' },
      })
      if (error || !data.user) { console.error(`[fail] ${u.email} : ${error?.message}`); continue }
      userId = data.user.id
      console.log(`[ok]   ${u.email} créé (id=${userId})`)
    }

    // Profil public.users : rôle + nom + changement forcé + org (si trouvée).
    const patch: Record<string, unknown> = {
      role: 'manager', full_name: u.full_name, must_change_password: true,
    }
    if (becibOrgId) patch.organization_id = becibOrgId
    const { error: upErr } = await supabase.from('users').update(patch).eq('id', userId)
    if (upErr) console.error(`[warn] profil ${u.email} : ${upErr.message}`)
  }

  console.log('\n=== Récapitulatif ===')
  console.log(`Mot de passe temporaire : ${TEMP_PASSWORD} (changement forcé à la 1re connexion)`)
  console.log(`Rôle : manager · Org BECIB : ${becibOrgId ?? 'NON rattachée (à faire dans /admin)'}`)
  for (const u of USERS) console.log(`  ${u.email}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
