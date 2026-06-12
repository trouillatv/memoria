/**
 * Verify multi-tenant isolation: check org assignments for key users and data.
 * USAGE: npx tsx scripts/dev/verify-orgs.ts
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

const BATISUD_ORG_ID = '3a666557-a84e-4d4b-a7f8-9bb4a48acfec'
const MVO_ORG_ID = '9862b3b2-b564-4f41-8b04-36a753d7442e'

async function main() {
  // Check users
  const { data: users } = await sb.from('users').select('email, role, organization_id').is('deleted_at', null)
  console.log('\n=== Users ===')
  for (const u of users ?? []) {
    const orgLabel = u.organization_id === BATISUD_ORG_ID ? 'BatiSud' : u.organization_id === MVO_ORG_ID ? 'MVO' : u.organization_id ?? 'NULL'
    console.log(`  ${u.email} | role=${u.role} | org=${orgLabel}`)
  }

  // Count BatiSud data
  const [sites, contracts, tenders] = await Promise.all([
    sb.from('sites').select('id', { count: 'exact', head: true }).eq('organization_id', BATISUD_ORG_ID).is('deleted_at', null),
    sb.from('contracts').select('id', { count: 'exact', head: true }).eq('organization_id', BATISUD_ORG_ID).is('deleted_at', null),
    sb.from('tenders').select('id', { count: 'exact', head: true }).eq('organization_id', BATISUD_ORG_ID).is('deleted_at', null),
  ])
  console.log(`\n=== BatiSud data ===`)
  console.log(`  Sites: ${sites.count}, Contracts: ${contracts.count}, Tenders: ${tenders.count}`)

  // Count MVO data
  const [mvoSites, mvoContracts, mvoTenders] = await Promise.all([
    sb.from('sites').select('id', { count: 'exact', head: true }).eq('organization_id', MVO_ORG_ID).is('deleted_at', null),
    sb.from('contracts').select('id', { count: 'exact', head: true }).eq('organization_id', MVO_ORG_ID).is('deleted_at', null),
    sb.from('tenders').select('id', { count: 'exact', head: true }).eq('organization_id', MVO_ORG_ID).is('deleted_at', null),
  ])
  console.log(`\n=== MVO data (Guillaume) ===`)
  console.log(`  Sites: ${mvoSites.count}, Contracts: ${mvoContracts.count}, Tenders: ${mvoTenders.count}`)

  // Check null org data
  const [nullSites, nullContracts] = await Promise.all([
    sb.from('sites').select('id', { count: 'exact', head: true }).is('organization_id', null).is('deleted_at', null),
    sb.from('contracts').select('id', { count: 'exact', head: true }).is('organization_id', null).is('deleted_at', null),
  ])
  console.log(`\n=== Unassigned (no org) ===`)
  console.log(`  Sites: ${nullSites.count}, Contracts: ${nullContracts.count}`)

  console.log('\n✓ Verification complete')
}

main().catch(console.error)
