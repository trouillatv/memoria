/**
 * scripts/chantierE-smoke.ts
 *
 * Smoke test programmatique du Chantier E — Rapport mensuel client.
 *
 * Couvre les invariants critiques :
 *
 *   1. parseMonthParam("2026-04") + formatMonthParam roundtrip
 *   2. getContractMonthlyReport sur un contrat actif réel
 *   3. createMonthlyReportToken (30 jours) avec photos sélectionnées + note DG
 *   4. getMonthlyReportFromToken retourne reportData + selectedPhotoIds + dgNote
 *   5. revokeShareToken → revoked_at NOT NULL (idempotent)
 *   6. Cleanup hard-delete du token de test
 *   7. parseMonthParam edge cases (février non bissextile = 28 jours, décembre = 31)
 *
 * Usage : `npx tsx scripts/chantierE-smoke.ts`
 *
 * Critère de succès : tous les asserts passent. Sinon, exit 1.
 *
 * Si aucun contrat actif n'existe : exit 1 avec message "Run seed-demo first".
 * Si le contrat existe mais qu'aucune photo n'est candidate (mois trop vide),
 * on skip la partie token création/récup en émettant un warning — les helpers
 * purs (parse/format/edge cases) restent testés.
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
 
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
import {
  parseMonthParam,
  formatMonthParam,
  getContractMonthlyReport,
} from '@/lib/db/monthly-report'
import {
  createMonthlyReportToken,
  getMonthlyReportFromToken,
  revokeShareToken,
  getShareTokenById,
} from '@/lib/db/proof-share'

async function main() {
  console.log('=== Chantier E smoke test — Rapport mensuel client ===\n')
  const supabase = createAdminClient()

  // 1. Trouver un contrat actif
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('id, name, client_name, start_date')
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (cErr) throw cErr
  if (!contract) {
    console.error('❌ Aucun contrat actif. Run scripts/seed-demo.ts first.')
    process.exit(1)
  }
  console.log(`✓ Contrat test : ${contract.name} (id=${contract.id})`)

  // 2. parseMonthParam roundtrip
  const period = parseMonthParam('2026-04')
  console.log(
    `✓ parseMonthParam("2026-04") → ${period.monthLabel} (${period.firstDay} → ${period.lastDay})`,
  )
  if (formatMonthParam(period) !== '2026-04') {
    throw new Error('Roundtrip parseMonthParam/formatMonthParam échec')
  }
  console.log('✓ formatMonthParam roundtrip OK')

  // 3. getContractMonthlyReport
  const reportData = await getContractMonthlyReport(contract.id, '2026-04')
  if (!reportData) throw new Error('reportData null pour un contrat valide')
  console.log(
    `✓ getContractMonthlyReport → counts: ${reportData.counts.interventionsExecuted} interv. / ${reportData.counts.photosCount} photos / ${reportData.photoCandidates.length} candidates`,
  )

  // 4. createMonthlyReportToken (si photos disponibles)
  const candidates = reportData.photoCandidates.slice(0, 3)
  const photoIds = candidates.map((p) => p.id)

  if (photoIds.length > 0) {
    const token = await createMonthlyReportToken({
      contractId: contract.id,
      reportMonth: '2026-04',
      durationDays: 30,
      selectedPhotoIds: photoIds,
      dgNote: 'Smoke test note du DG.',
    })
    console.log(
      `✓ createMonthlyReportToken → token=${token.token.slice(0, 10)}..., expires_at=${token.expires_at}`,
    )

    // 5. getMonthlyReportFromToken
    const fetched = await getMonthlyReportFromToken(token.token)
    if (!fetched) throw new Error('getMonthlyReportFromToken null')
    console.log(
      `✓ getMonthlyReportFromToken → reportData récupérée, ${fetched.selectedPhotoIds.length} photos sélectionnées, note="${fetched.dgNote.slice(0, 40)}..."`,
    )

    // 6. Revocation
    await revokeShareToken(token.id)
    const revoked = await getShareTokenById(token.id)
    if (!revoked?.revoked_at) throw new Error('Token non révoqué après revokeShareToken')
    console.log(`✓ revokeShareToken → revoked_at=${revoked.revoked_at}`)

    // 7. Cleanup hard-delete du token smoke
    await supabase.from('proof_share_tokens').delete().eq('id', token.id)
    console.log('✓ Cleanup OK (token smoke supprimé)')
  } else {
    console.log(
      '⚠ Pas de photos candidates pour le contrat test sur 2026-04 — skip token creation. Run scripts/seed-demo.ts pour data riche.',
    )
  }

  // 8. parseMonthParam edge cases
  const fev = parseMonthParam('2026-02')
  if (fev.lastDay !== '2026-02-28') {
    throw new Error(`Février non bissextile attendu lastDay=2026-02-28, reçu ${fev.lastDay}`)
  }
  console.log('✓ parseMonthParam("2026-02") → lastDay=2026-02-28 (non bissextile)')

  const dec = parseMonthParam('2026-12')
  if (dec.lastDay !== '2026-12-31') {
    throw new Error(`Décembre attendu lastDay=2026-12-31, reçu ${dec.lastDay}`)
  }
  console.log('✓ parseMonthParam("2026-12") → lastDay=2026-12-31')

  console.log('\n✅ Chantier E smoke OK')
}

main().catch((err) => {
  console.error('❌ Chantier E smoke FAILED:', err)
  process.exit(1)
})
