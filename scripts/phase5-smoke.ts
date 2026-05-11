/* eslint-disable no-console */
/**
 * scripts/phase5-smoke.ts
 *
 * Smoke test programmatique du flow Phase 5 — Dossier de preuves.
 *
 * Vérifie le flow complet en 10 étapes :
 *   1. Pick d'une intervention exécutée (seed-demo + ensure-today requis)
 *   2. searchProofs sans filtre → au moins 1 résultat
 *   3. searchProofs avec dateFrom/dateTo (30 derniers jours)
 *   4. getProofDetail → preuve complète (photos / validations / anomalies)
 *   5. createShareToken (default 7 jours)
 *   6. getShareTokenByValue → token retrouvé
 *   7. recordShareAccess → access_count incrémenté
 *   8. createShareToken includeIdentities=true → flag bien stocké
 *   9. revokeShareToken → revoked_at NOT NULL
 *  10. Cleanup automatique des tokens créés
 *
 * Usage : `npx tsx scripts/phase5-smoke.ts`
 *
 * Critère de succès : tous les asserts passent. Sinon, exit 1.
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

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

import { createAdminClient } from '@/lib/supabase/admin'
import { searchProofs, getProofDetail } from '@/lib/db/proofs'
import {
  createShareToken,
  getShareTokenByValue,
  getShareTokenById,
  revokeShareToken,
  recordShareAccess,
} from '@/lib/db/proof-share'

async function main() {
  console.log('=== Phase 5 smoke test — Dossier de preuves ===\n')
  const supabase = createAdminClient()

  // ----- 1. Pick a tenant with executed interventions -----------------------
  // On veut une intervention qui ait au moins quelques photos / une validation
  // pour rendre le test réaliste. On préfère une intervention executed/validated
  // (mais on accepte n'importe quelle exécutée).
  const { data: candidates, error: candErr } = await supabase
    .from('interventions')
    .select('id, mission_id, scheduled_at, scheduled_for, status')
    .in('status', ['completed', 'validated'])
    .order('scheduled_at', { ascending: false })
    .limit(20)
  if (candErr) throw candErr
  if (!candidates || candidates.length === 0) {
    console.error(
      '❌ Aucune intervention exécutée trouvée. Run `npx tsx scripts/seed-demo.ts` first.',
    )
    process.exit(1)
  }

  // On prend de préférence une intervention avec photos (les tests "details"
  // sont plus parlants quand il y a quelque chose à montrer).
  let someIntervention: { id: string; mission_id: string; scheduled_at: string } | null =
    null
  for (const c of candidates) {
    const { count } = await supabase
      .from('intervention_photos')
      .select('id', { count: 'exact', head: true })
      .eq('intervention_id', c.id as string)
    if ((count ?? 0) > 0) {
      someIntervention = c as {
        id: string
        mission_id: string
        scheduled_at: string
      }
      break
    }
  }
  // Fallback : si personne n'a de photo, on prend la plus récente quand même.
  if (!someIntervention) {
    someIntervention = candidates[0] as {
      id: string
      mission_id: string
      scheduled_at: string
    }
  }
  console.log(`✓ Found intervention to test : ${someIntervention.id.slice(0, 8)}…`)

  // ----- 2. searchProofs sans filtre ----------------------------------------
  const all = await searchProofs({ limit: 5 })
  console.log(
    `✓ searchProofs (no filter) → ${all.items.length} items, total=${all.total}`,
  )
  if (all.total < 1) {
    throw new Error('Empty search results — seed required')
  }

  // ----- 3. searchProofs avec date filter -----------------------------------
  const today = new Date().toISOString().slice(0, 10)
  const fromLast30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const byDate = await searchProofs({
    dateFrom: fromLast30,
    dateTo: today,
    limit: 5,
  })
  console.log(
    `✓ searchProofs (last 30 days) → ${byDate.items.length} items, total=${byDate.total}`,
  )

  // ----- 4. getProofDetail --------------------------------------------------
  const detail = await getProofDetail(someIntervention.id)
  if (!detail) throw new Error('getProofDetail returned null')
  console.log(
    `✓ getProofDetail → mission="${detail.mission_name}", site="${detail.site_name}", ` +
      `photos=${detail.photos.length}, validations=${detail.validations.length}, ` +
      `anomalies=${detail.anomalies.length}, checklist=${detail.checklist.length}`,
  )

  // ----- 5. createShareToken (default 7 days) -------------------------------
  const token = await createShareToken({ interventionId: detail.id })
  const tokenPreview = token.token.slice(0, 8)
  console.log(
    `✓ createShareToken → token=${tokenPreview}…, expires_at=${token.expires_at}, ` +
      `include_identities=${token.include_identities}`,
  )
  // Sanity check : 7 jours ± 1 jour (selon timezone DB / Node).
  const expiresInMs =
    new Date(token.expires_at).getTime() - new Date(token.created_at).getTime()
  const expiresInDays = Math.round(expiresInMs / (24 * 60 * 60 * 1000))
  if (expiresInDays !== 7) {
    throw new Error(
      `Expected 7-day default expiry, got ${expiresInDays} days (expires_at=${token.expires_at}, created_at=${token.created_at})`,
    )
  }

  // ----- 6. getShareTokenByValue --------------------------------------------
  const fetched = await getShareTokenByValue(token.token)
  if (!fetched) throw new Error('getShareTokenByValue returned null')
  if (fetched.id !== token.id) {
    throw new Error(`Token ID mismatch: expected ${token.id}, got ${fetched.id}`)
  }
  console.log(`✓ getShareTokenByValue → matches (id=${fetched.id.slice(0, 8)}…)`)

  // ----- 7. recordShareAccess -----------------------------------------------
  await recordShareAccess(token.id)
  const afterAccess = await getShareTokenById(token.id)
  if (!afterAccess) throw new Error('Token disappeared after recordShareAccess')
  if (afterAccess.access_count !== 1) {
    throw new Error(
      `access_count not incremented: expected 1, got ${afterAccess.access_count}`,
    )
  }
  if (!afterAccess.last_accessed_at) {
    throw new Error('last_accessed_at not set after recordShareAccess')
  }
  console.log(
    `✓ recordShareAccess → access_count=${afterAccess.access_count}, ` +
      `last_accessed_at=${afterAccess.last_accessed_at}`,
  )

  // ----- 8. Token avec include_identities ----------------------------------
  const idToken = await createShareToken({
    interventionId: detail.id,
    includeIdentities: true,
  })
  if (!idToken.include_identities) {
    throw new Error('include_identities flag not stored (expected true)')
  }
  console.log(
    `✓ createShareToken (includeIdentities=true) → flag stored ` +
      `(token=${idToken.token.slice(0, 8)}…)`,
  )

  // ----- 9. Revocation ------------------------------------------------------
  await revokeShareToken(token.id)
  const revoked = await getShareTokenById(token.id)
  if (!revoked) throw new Error('Token disappeared after revoke')
  if (!revoked.revoked_at) {
    throw new Error('Token not revoked (revoked_at still null)')
  }
  // Bonus : getShareTokenByValue doit maintenant rendre null sur ce token.
  const afterRevokeLookup = await getShareTokenByValue(token.token)
  if (afterRevokeLookup !== null) {
    throw new Error(
      'getShareTokenByValue should return null for a revoked token',
    )
  }
  console.log(
    `✓ revokeShareToken → revoked_at=${revoked.revoked_at} ` +
      `(public lookup correctly returns null)`,
  )

  // ----- 10. Cleanup --------------------------------------------------------
  await supabase.from('proof_share_tokens').delete().eq('id', token.id)
  await supabase.from('proof_share_tokens').delete().eq('id', idToken.id)
  console.log(`✓ Cleanup OK (deleted ${2} test tokens)`)

  console.log('')
  console.log('✅ Phase 5 smoke OK :')
  console.log(
    '   - Search retrieves proofs across filters (no filter / dateFrom-To)',
  )
  console.log(
    '   - getProofDetail returns full proof with photos/validations/anomalies',
  )
  console.log('   - createShareToken creates a 7-day token by default')
  console.log(
    '   - recordShareAccess increments access_count + last_accessed_at',
  )
  console.log('   - include_identities flag persists correctly')
  console.log(
    '   - revokeShareToken sets revoked_at and invalidates public lookup',
  )
}

main().catch((err) => {
  console.error('[phase5-smoke] ❌ Fatal:', err)
  process.exit(1)
})
