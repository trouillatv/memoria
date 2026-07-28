/**
 * scripts/dev/probe-collaboration-demo.ts
 *
 * LECTURE SEULE — aucune écriture. Identifie l'org démo (via un e-mail) et mesure
 * l'existant utile au graphe de collaboration (entreprises, contacts, chantiers,
 * castings, actions, équipes), pour cadrer un seed sûr et idempotent.
 *
 * Usage : tsx scripts/dev/probe-collaboration-demo.ts [email]
 */
import * as fs from 'fs'

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
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!
  }
}

async function main() {
  loadEnvLocal()
  const email = process.argv[2] ?? 'demo@memoria.nc'
  const db = createAdminClient()

  // Indice d'environnement (host uniquement, jamais la clé).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '(inconnu)'
  console.log('Supabase host :', url.replace(/^https?:\/\//, '').split('.')[0], '\n')

  const { data: orgs } = await db.from('organizations').select('id, name').limit(30)
  console.log('Organisations :')
  for (const o of (orgs ?? []) as Array<{ id: string; name: string }>) console.log('  -', o.name, '·', o.id)

  const { data: user } = await db.from('users').select('id, organization_id, full_name, email').eq('email', email).maybeSingle()
  if (!user) { console.log(`\nAucun utilisateur ${email}.`); return }
  const orgId = (user as { organization_id: string }).organization_id
  console.log(`\nUtilisateur ${email} → org ${orgId}`)

  const counts: Record<string, number> = {}
  for (const table of ['companies', 'company_contacts', 'sites', 'teams'] as const) {
    const { count } = await db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
    counts[table] = count ?? 0
  }
  // site_intervenants / site_actions : via les sites de l'org.
  const { data: siteRows } = await db.from('sites').select('id').eq('organization_id', orgId).is('deleted_at', null)
  const siteIds = ((siteRows ?? []) as Array<{ id: string }>).map((s) => s.id)
  if (siteIds.length) {
    const { count: cast } = await db.from('site_intervenants').select('id', { count: 'exact', head: true }).in('site_id', siteIds)
    const { count: act } = await db.from('site_actions').select('id', { count: 'exact', head: true }).in('site_id', siteIds).not('assigned_company_id', 'is', null)
    counts['site_intervenants (castings)'] = cast ?? 0
    counts['site_actions (avec entreprise)'] = act ?? 0
  }
  console.log('\nExistant (org démo) :')
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(30)} ${v}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
