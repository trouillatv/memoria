/**
 * scripts/dev/cleanup-test-data.ts
 *
 * Supprime toutes les données créées par les tests intégration (`__test_*`),
 * sans toucher au seed NC (qui utilise des noms réalistes : "Nouméa Centre",
 * "Lycée Lapérouse", "CHT Magenta"…).
 *
 * Pattern test : toutes les entrées dont le nom/titre/email commence par
 * `__test_` (convention `tests/lib/*.test.ts`).
 *
 * USAGE
 *   npm exec tsx scripts/dev/cleanup-test-data.ts -- --yes
 *
 * Refus :
 *   - NODE_ENV=production
 *   - URL contenant 'prod' / 'production' / 'live'
 *   - --yes absent → dry-run (count uniquement)
 *
 * Ordre de suppression : enfants → parents (FK).
 */

import * as fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { createAdminClient } from '@/lib/supabase/admin'

// .env.local loader (même pattern que NC seed)
function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const TEST_PREFIX = '__test_'
const TEST_LIKE = `${TEST_PREFIX}%`

interface Args {
  yes: boolean
}
function parseArgs(argv: string[]): Args {
  return { yes: argv.includes('--yes') || argv.includes('-y') }
}

function fail(msg: string): never {
  console.error('[cleanup] REFUS:', msg)
  process.exit(1)
}

function assertSafe(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  console.log('[safety] NODE_ENV =', nodeEnv)
  console.log('[safety] SUPABASE_URL =', url || '(absent)')

  if (nodeEnv === 'production') fail('NODE_ENV=production refusé.')
  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL absent.')
  for (const m of ['prod', 'production', 'live']) {
    if (url.toLowerCase().includes(m)) {
      fail(`URL contient "${m}" — abandon par précaution.`)
    }
  }
}

type Admin = ReturnType<typeof createAdminClient>

// --------------------------------------------------------------------------
// Helpers de comptage / suppression par préfixe
// --------------------------------------------------------------------------

async function countLike(
  admin: Admin,
  table: string,
  column: string,
  pattern: string,
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .like(column, pattern)
  if (error) {
    console.warn(`  ⚠ count ${table}.${column}: ${error.message}`)
    return 0
  }
  return count ?? 0
}

async function deleteLike(
  admin: Admin,
  table: string,
  column: string,
  pattern: string,
  label: string,
): Promise<number> {
  // On utilise select+delete pour récupérer le nombre supprimé.
  // Supabase ne renvoie pas le count sur delete sans returning.
  const { data: toDelete, error: selErr } = await admin
    .from(table)
    .select('id')
    .like(column, pattern)
  if (selErr) {
    console.warn(`  ⚠ select ${table}.${column}: ${selErr.message}`)
    return 0
  }
  const ids = (toDelete ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) {
    console.log(`  · ${label} : 0 ligne à supprimer.`)
    return 0
  }
  const { error: delErr } = await admin.from(table).delete().in('id', ids)
  if (delErr) {
    console.warn(`  ✗ delete ${table}: ${delErr.message}`)
    return 0
  }
  console.log(`  ✓ ${label} : ${ids.length} ligne(s) supprimée(s).`)
  return ids.length
}

async function deleteCascadeFromParent(
  admin: Admin,
  parentTable: string,
  parentColumn: string,
  parentPattern: string,
  childTable: string,
  childFkColumn: string,
  label: string,
): Promise<number> {
  const { data: parents, error } = await admin
    .from(parentTable)
    .select('id')
    .like(parentColumn, parentPattern)
  if (error) {
    console.warn(`  ⚠ select ${parentTable}: ${error.message}`)
    return 0
  }
  const ids = (parents ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) {
    console.log(`  · ${label} : 0 (aucun parent).`)
    return 0
  }
  const { data: rows, error: e2 } = await admin
    .from(childTable)
    .select('id')
    .in(childFkColumn, ids)
  if (e2) {
    console.warn(`  ⚠ select ${childTable}: ${e2.message}`)
    return 0
  }
  const childIds = (rows ?? []).map((r: { id: string }) => r.id)
  if (childIds.length === 0) {
    console.log(`  · ${label} : 0 ligne enfant.`)
    return 0
  }
  const { error: e3 } = await admin.from(childTable).delete().in('id', childIds)
  if (e3) {
    console.warn(`  ✗ delete ${childTable}: ${e3.message}`)
    return 0
  }
  console.log(`  ✓ ${label} : ${childIds.length} ligne(s) enfants supprimée(s).`)
  return childIds.length
}

// --------------------------------------------------------------------------
// Suppression des comptes auth `__test_*@*`
// --------------------------------------------------------------------------

async function cleanupAuthTestUsers(admin: Admin): Promise<number> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) {
    console.warn('  ⚠ listUsers: ' + error.message)
    return 0
  }
  const testUsers = (data?.users ?? []).filter(
    (u) => u.email && u.email.startsWith(TEST_PREFIX),
  )
  if (testUsers.length === 0) {
    console.log('  · auth users __test_* : 0 compte à supprimer.')
    return 0
  }
  let deleted = 0
  for (const u of testUsers) {
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id)
    if (delErr) {
      console.warn(`  ⚠ deleteUser ${u.email}: ${delErr.message}`)
      continue
    }
    deleted++
  }
  console.log(`  ✓ auth users __test_* : ${deleted}/${testUsers.length} compte(s) supprimé(s).`)
  return deleted
}

// --------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertSafe()

  if (!args.yes) {
    console.log('\n[cleanup] DRY-RUN — comptage uniquement. Ajoute --yes pour appliquer.\n')
  } else {
    console.log('\n[cleanup] ⚠️  MODE DESTRUCTIF (--yes)\n')
  }

  const admin = createAdminClient()

  // -------------- DRY-RUN : comptage --------------
  if (!args.yes) {
    const counts: Record<string, number> = {}
    counts['teams'] = await countLike(admin, 'teams', 'name', TEST_LIKE)
    counts['contracts'] = await countLike(admin, 'contracts', 'name', TEST_LIKE)
    counts['clients'] = await countLike(admin, 'clients', 'name', TEST_LIKE)
    counts['tenders'] = await countLike(admin, 'tenders', 'title', TEST_LIKE)
    counts['sites'] = await countLike(admin, 'sites', 'name', TEST_LIKE)
    counts['missions'] = await countLike(admin, 'missions', 'name', TEST_LIKE)
    counts['knowledge_items'] = await countLike(admin, 'knowledge_items', 'title', TEST_LIKE)
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
    counts['auth_users'] = (users?.users ?? []).filter(
      (u) => u.email && u.email.startsWith(TEST_PREFIX),
    ).length

    console.log('\n========== DRY-RUN ==========')
    for (const [k, v] of Object.entries(counts)) {
      console.log(`  ${k.padEnd(20)} : ${v}`)
    }
    console.log('\nRelance avec --yes pour appliquer.')
    return
  }

  // -------------- SUPPRESSION : ordre dépendances --------------
  let total = 0

  console.log('\n[1/12] team_members (via team.name __test_*) :')
  total += await deleteCascadeFromParent(
    admin, 'teams', 'name', TEST_LIKE, 'team_members', 'team_id', 'team_members',
  )

  console.log('\n[2/12] proof_share_tokens (via intervention/mission/contract):')
  // Tokens liés à des interventions des missions des sites des contrats __test
  // → on attaque par contrat puis on remonte. Plus simple : on supprime les
  // tokens dont l'intervention_id pointe sur une intervention d'une mission
  // d'un contrat __test. On fait via select+delete in chunks.
  total += await cleanupProofSharesForTestContracts(admin)

  console.log('\n[3/12] intervention_photos / validations / anomalies / checklist :')
  total += await cleanupInterventionChildrenForTestContracts(admin)

  console.log('\n[4/12] interventions :')
  total += await cleanupInterventionsForTestContracts(admin)

  console.log('\n[5/12] intervention_templates :')
  total += await cleanupTemplatesForTestContracts(admin)

  console.log('\n[6/12] missions :')
  total += await deleteMissionsForTestContracts(admin)

  console.log('\n[7/12] engagements :')
  total += await cleanupEngagementsForTestContracts(admin)

  console.log('\n[8/12] sites (__test_* OR rattachés à un contrat __test) :')
  total += await cleanupSitesForTestContracts(admin)
  total += await deleteLike(admin, 'sites', 'name', TEST_LIKE, 'sites (name __test_*)')

  console.log('\n[9/12] contracts (name __test_*) :')
  total += await deleteLike(admin, 'contracts', 'name', TEST_LIKE, 'contracts')

  console.log('\n[10/12] tender_* (analyses, chat, documents, agents) :')
  total += await cleanupTenderChildrenForTestTenders(admin)

  console.log('\n[11/12] tenders + clients + knowledge_items + teams :')
  total += await deleteLike(admin, 'tenders', 'title', TEST_LIKE, 'tenders')
  total += await deleteLike(admin, 'clients', 'name', TEST_LIKE, 'clients')
  total += await deleteLike(admin, 'knowledge_items', 'title', TEST_LIKE, 'knowledge_items')
  total += await deleteLike(admin, 'teams', 'name', TEST_LIKE, 'teams')

  console.log('\n[12/12] auth users __test_* :')
  total += await cleanupAuthTestUsers(admin)

  console.log(`\n[done] Total lignes supprimées : ${total}`)
}

// --------------------------------------------------------------------------
// Helpers spécifiques aux cascades
// --------------------------------------------------------------------------

async function getTestContractIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('contracts').select('id').like('name', TEST_LIKE)
  return (data ?? []).map((r: { id: string }) => r.id)
}

async function getTestMissionIds(admin: Admin): Promise<string[]> {
  const contractIds = await getTestContractIds(admin)
  if (contractIds.length === 0) {
    // Filet : missions avec name __test_* mais contract NULL/external
    const { data } = await admin.from('missions').select('id').like('name', TEST_LIKE)
    return (data ?? []).map((r: { id: string }) => r.id)
  }
  // Sites de ces contrats
  const { data: sites } = await admin.from('sites').select('id').in('contract_id', contractIds)
  const siteIds = (sites ?? []).map((r: { id: string }) => r.id)
  if (siteIds.length === 0) return []
  const { data: missions } = await admin.from('missions').select('id').in('site_id', siteIds)
  const missionIds = (missions ?? []).map((r: { id: string }) => r.id)
  // + missions avec name __test_* directement
  const { data: extra } = await admin.from('missions').select('id').like('name', TEST_LIKE)
  for (const r of extra ?? []) {
    if (!missionIds.includes(r.id)) missionIds.push(r.id)
  }
  return missionIds
}

async function getTestInterventionIds(admin: Admin): Promise<string[]> {
  const missionIds = await getTestMissionIds(admin)
  if (missionIds.length === 0) return []
  const { data } = await admin
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  return (data ?? []).map((r: { id: string }) => r.id)
}

async function cleanupProofSharesForTestContracts(admin: Admin): Promise<number> {
  const interventionIds = await getTestInterventionIds(admin)
  const contractIds = await getTestContractIds(admin)
  let total = 0
  if (interventionIds.length > 0) {
    const { data: rows } = await admin
      .from('proof_share_tokens')
      .select('id')
      .in('intervention_id', interventionIds)
    const ids = (rows ?? []).map((r: { id: string }) => r.id)
    if (ids.length > 0) {
      await admin.from('proof_share_tokens').delete().in('id', ids)
      console.log(`  ✓ proof_share_tokens (intervention) : ${ids.length}`)
      total += ids.length
    }
  }
  if (contractIds.length > 0) {
    const { data: rows } = await admin
      .from('proof_share_tokens')
      .select('id')
      .in('contract_id', contractIds)
    const ids = (rows ?? []).map((r: { id: string }) => r.id)
    if (ids.length > 0) {
      await admin.from('proof_share_tokens').delete().in('id', ids)
      console.log(`  ✓ proof_share_tokens (contract) : ${ids.length}`)
      total += ids.length
    }
  }
  return total
}

async function cleanupInterventionChildrenForTestContracts(
  admin: Admin,
): Promise<number> {
  const interventionIds = await getTestInterventionIds(admin)
  if (interventionIds.length === 0) {
    console.log('  · 0 intervention parente.')
    return 0
  }
  let total = 0
  for (const childTable of [
    'intervention_photos',
    'intervention_validations',
    'intervention_anomalies',
    'intervention_checklist_items',
    'intervention_participants',
  ]) {
    const { data: rows, error } = await admin
      .from(childTable)
      .select('id, intervention_id')
      .in('intervention_id', interventionIds)
    if (error) {
      // intervention_participants peut ne pas avoir id (PK composite)
      // → fallback delete par fkey
      const { error: e2 } = await admin
        .from(childTable)
        .delete()
        .in('intervention_id', interventionIds)
      if (!e2) console.log(`  ✓ ${childTable} : (delete sans count)`)
      continue
    }
    const ids = (rows ?? [])
      .map((r: { id?: string }) => r.id)
      .filter((id): id is string => !!id)
    if (ids.length > 0) {
      await admin.from(childTable).delete().in('id', ids)
      console.log(`  ✓ ${childTable} : ${ids.length}`)
      total += ids.length
    } else {
      // Cas intervention_participants (PK composite) — utilise fkey
      const { error: delErr } = await admin
        .from(childTable)
        .delete()
        .in('intervention_id', interventionIds)
      if (!delErr) console.log(`  ✓ ${childTable} : (delete sans count)`)
    }
  }
  return total
}

async function cleanupInterventionsForTestContracts(admin: Admin): Promise<number> {
  const ids = await getTestInterventionIds(admin)
  if (ids.length === 0) return 0
  await admin.from('interventions').delete().in('id', ids)
  console.log(`  ✓ interventions : ${ids.length}`)
  return ids.length
}

async function cleanupTemplatesForTestContracts(admin: Admin): Promise<number> {
  const missionIds = await getTestMissionIds(admin)
  if (missionIds.length === 0) return 0
  const { data } = await admin
    .from('intervention_templates')
    .select('id')
    .in('mission_id', missionIds)
  const ids = (data ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) return 0
  await admin.from('intervention_templates').delete().in('id', ids)
  console.log(`  ✓ intervention_templates : ${ids.length}`)
  return ids.length
}

async function deleteMissionsForTestContracts(admin: Admin): Promise<number> {
  const ids = await getTestMissionIds(admin)
  if (ids.length === 0) return 0
  await admin.from('missions').delete().in('id', ids)
  console.log(`  ✓ missions : ${ids.length}`)
  return ids.length
}

async function cleanupEngagementsForTestContracts(admin: Admin): Promise<number> {
  const contractIds = await getTestContractIds(admin)
  if (contractIds.length === 0) return 0
  const { data } = await admin.from('engagements').select('id').in('contract_id', contractIds)
  const ids = (data ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) return 0
  await admin.from('engagements').delete().in('id', ids)
  console.log(`  ✓ engagements : ${ids.length}`)
  return ids.length
}

async function cleanupSitesForTestContracts(admin: Admin): Promise<number> {
  const contractIds = await getTestContractIds(admin)
  if (contractIds.length === 0) return 0
  const { data } = await admin.from('sites').select('id').in('contract_id', contractIds)
  const ids = (data ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) return 0
  await admin.from('sites').delete().in('id', ids)
  console.log(`  ✓ sites (FK contract __test) : ${ids.length}`)
  return ids.length
}

async function cleanupTenderChildrenForTestTenders(admin: Admin): Promise<number> {
  const { data: tenders } = await admin.from('tenders').select('id').like('title', TEST_LIKE)
  const tenderIds = (tenders ?? []).map((r: { id: string }) => r.id)
  if (tenderIds.length === 0) return 0
  let total = 0
  for (const t of [
    'tender_agent_analyses',
    'tender_chat_attachments',
    'tender_chat_messages',
    'tender_analyses',
    'tender_documents',
  ]) {
    const { data: rows } = await admin.from(t).select('id').in('tender_id', tenderIds)
    const ids = (rows ?? []).map((r: { id: string }) => r.id)
    if (ids.length === 0) continue
    await admin.from(t).delete().in('id', ids)
    console.log(`  ✓ ${t} : ${ids.length}`)
    total += ids.length
  }
  return total
}

main().catch((e) => {
  console.error('[cleanup-test-data] failed:', e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
})
