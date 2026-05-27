/**
 * scripts/dev/list-legacy-domain-emails.ts — LECTURE SEULE.
 *
 * Audite les comptes dont l'email porte encore l'ANCIEN domaine hérité
 * (terme legacy proscrit, conservé ici uniquement comme littéral de recherche
 * de ce qu'on cherche à éradiquer — cf. règle « le projet s'appelle MemorIA »)
 * sur auth + public.users, et propose la cible @memoria.nc. NE MODIFIE RIEN.
 *
 * USAGE : npm exec tsx scripts/dev/list-legacy-domain-emails.ts
 */
import * as fs from 'fs'

const LEGACY_DOMAIN_TERM = 'netoiage' // littéral hérité à détecter puis migrer


const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

function toMemoria(email: string): string {
  // Remplace le domaine (tout après @) par memoria.nc, garde la partie locale.
  const at = email.indexOf('@')
  return at === -1 ? email : `${email.slice(0, at)}@memoria.nc`
}

async function main() {
  const admin = createAdminClient()

  // 1) Comptes AUTH
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const authMatches = (data?.users ?? []).filter((u) =>
    u.email?.toLowerCase().includes(LEGACY_DOMAIN_TERM),
  )

  // 2) Lignes public.users
  const { data: rows } = await admin
    .from('users')
    .select('id, email, full_name, role, deleted_at')
    .ilike('email', `%${LEGACY_DOMAIN_TERM}%`)

  console.log(`\n=== AUTH users domaine hérité : ${authMatches.length} ===`)
  for (const u of authMatches) {
    console.log(`  ${u.email}  ->  ${toMemoria(u.email!)}   [id ${u.id}]`)
  }

  console.log(`\n=== public.users domaine hérité : ${rows?.length ?? 0} ===`)
  for (const r of (rows ?? []) as Array<{ email: string; full_name: string | null; role: string; deleted_at: string | null }>) {
    const del = r.deleted_at ? ' (supprimé)' : ''
    console.log(`  ${r.email}  ->  ${toMemoria(r.email)}   [${r.full_name ?? '—'} · ${r.role}${del}]`)
  }
  console.log('\n(LECTURE SEULE — rien modifié.)')
}

main().catch((e) => {
  console.error('[list-legacy-domain-emails] failed:', e)
  process.exit(1)
})
