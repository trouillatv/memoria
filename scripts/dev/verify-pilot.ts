/**
 * scripts/dev/verify-pilot.ts — LECTURE SEULE.
 *
 * Vérifie que la base pilote est cohérente et que chaque parcours critique
 * aura du contenu à afficher. Ne peut pas simuler un login navigateur (mots de
 * passe non connus — décision « reset pas »), donc vérifie au niveau données :
 *   - comptes + rôles + must_change_password (conditionne le login)
 *   - /dashboard : sites/contrats/interventions présents
 *   - /m (terrain) : Guillaume rattaché à une équipe avec interventions assignées
 *   - /handovers + /h/[token] : brief partagé résolvable
 *   - /documents : documents présents
 *   - /sites/[id] + /contracts/[id] : un id exploitable avec données liées
 *
 * USAGE : npx tsx scripts/dev/verify-pilot.ts --confirm-on=srixnofmaydxouhucawn
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })


const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'

const KEEP = ['admin@memoria.nc', 'manager@memoria.nc', 'guillaume.demene@memoria.nc']

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const confirmOn = process.argv.find((a) => a.startsWith('--confirm-on='))?.slice('--confirm-on='.length)
  if (!confirmOn || !url.includes(confirmOn)) {
    console.error('✗ passe --confirm-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL>.'); process.exit(1)
  }
  const sb = createAdminClient()
  const warnings: string[] = []
  const ok = (c: boolean) => (c ? '✅' : '❌')

  // Comptes
  console.log('\n=== COMPTES (login) ===')
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
  const authByEmail = new Map((list?.users ?? []).map((u) => [u.email, u]))
  const { data: pub } = await sb.from('users').select('id, email, role, must_change_password, full_name')
  const pubByEmail = new Map((pub ?? []).map((u: { email: string }) => [u.email, u]))
  console.log(`  Comptes auth total : ${list?.users?.length ?? 0} (attendu 3)`)
  for (const e of KEEP) {
    const a = authByEmail.get(e)
    const p = pubByEmail.get(e) as { role: string; must_change_password: boolean } | undefined
    const mcp = p?.must_change_password
    if (mcp) warnings.push(`${e} a must_change_password=true → sera forcé vers /change-password au 1er login.`)
    console.log(`  ${ok(!!a)} ${e.padEnd(32)} role=${p?.role ?? '?'}  must_change_password=${mcp ?? '?'}`)
  }
  const extra = (list?.users ?? []).filter((u) => !KEEP.includes(u.email ?? ''))
  console.log(`  ${ok(extra.length === 0)} Aucun compte hors liste (${extra.length} trouvé(s))`)

  // Counts globaux
  console.log('\n=== DONNÉES SEEDÉES ===')
  const tablesToCount = ['clients', 'contracts', 'engagements', 'sites', 'missions', 'interventions',
    'intervention_photos', 'intervention_anomalies', 'intervention_validations', 'documents',
    'document_collections', 'handover_briefs', 'teams', 'team_members', 'tenders']
  const counts: Record<string, number> = {}
  for (const t of tablesToCount) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true })
    counts[t] = count ?? 0
    console.log(`  ${t.padEnd(28)} ${count ?? 0}`)
  }

  // /dashboard
  console.log('\n=== PARCOURS ===')
  console.log(`  ${ok(counts.sites > 0 && counts.contracts > 0 && counts.interventions > 0)} /dashboard : sites+contrats+interventions présents`)

  // /m terrain : Guillaume → équipe → interventions assignées
  const g = pubByEmail.get('guillaume.demene@memoria.nc') as { id: string } | undefined
  const { data: gTeams } = await sb.from('team_members').select('team_id').eq('user_id', g?.id ?? '')
  const teamIds = (gTeams ?? []).map((r: { team_id: string }) => r.team_id)
  let assigned = 0
  if (teamIds.length) {
    const { count } = await sb.from('interventions').select('*', { count: 'exact', head: true }).in('assigned_team_id', teamIds)
    assigned = count ?? 0
  }
  console.log(`  ${ok(teamIds.length > 0 && assigned > 0)} /m terrain : Guillaume dans ${teamIds.length} équipe(s), ${assigned} interventions assignées`)

  // /handovers + /h/[token]
  const { data: briefs } = await sb.from('handover_briefs').select('*')
  const tokenOf = (b: Record<string, unknown>) => (b.shared_token ?? b.share_token ?? b.token) as string | null
  const expOf = (b: Record<string, unknown>) => (b.share_expires_at ?? b.shared_expires_at ?? b.expires_at) as string | null
  const shared = (briefs ?? []).filter((b) => tokenOf(b as Record<string, unknown>))
  console.log(`  ${ok(shared.length > 0)} /handovers : ${briefs?.length ?? 0} brief(s), ${shared.length} partagé(s)`)
  for (const b of shared as Array<Record<string, unknown>>) {
    const expRaw = expOf(b)
    const exp = expRaw ? new Date(expRaw) > new Date() : true
    console.log(`     ${ok(exp)} /h/${tokenOf(b)} ${exp ? '(valide)' : '(EXPIRÉ)'}`)
  }

  // /documents
  console.log(`  ${ok(counts.documents > 0)} /documents : ${counts.documents} document(s) dans ${counts.document_collections} collection(s)`)

  // /sites/[id] + /contracts/[id]
  const { data: oneSite } = await sb.from('sites').select('id, name').is('deleted_at', null).limit(1).maybeSingle()
  const { data: oneContract } = await sb.from('contracts').select('id, name').limit(1).maybeSingle()
  if (oneSite) {
    const { count: mCount } = await sb.from('missions').select('*', { count: 'exact', head: true }).eq('site_id', oneSite.id)
    console.log(`  ${ok(!!oneSite)} /sites/${oneSite.id} (« ${oneSite.name} », ${mCount ?? 0} mission(s))`)
  }
  if (oneContract) {
    const { count: eCount } = await sb.from('engagements').select('*', { count: 'exact', head: true }).eq('contract_id', oneContract.id)
    console.log(`  ${ok(!!oneContract)} /contracts/${oneContract.id} (« ${oneContract.name} », ${eCount ?? 0} engagement(s))`)
  }

  if (warnings.length) {
    console.log('\n=== ⚠️ WARNINGS ===')
    for (const w of warnings) console.log(`  - ${w}`)
  } else {
    console.log('\n✅ Aucun warning.')
  }
  console.log('\n(LECTURE SEULE.)')
}

main().catch((e) => { console.error('VERIFY FAILED:', e); process.exit(1) })
