// Phase 6E.3B.1 — PENDING EVIDENCE PERSISTENCE — BACKFILL (mandat Vincent, migration 394
// déjà appliquée via `npm run db:push`).
//
// Ne fait QUE écrire, via l'unique writer sanctionné public.resolve_pending_trace_evidence
// (migration 394) — jamais un INSERT/UPDATE direct sur tracked_point_pending_trace ou
// tracked_point_pending_trace_evidence. Aucune nouvelle heuristique de classification :
// consomme tel quel les deux rapports figés déjà validés ZERO DRIFT contre la population
// live (scripts/_p6e3a-pending-trace-evidence-reconstruction-audit-report.json,
// scripts/_p6e3a1-whole-thread-condition-validation-audit-report.json).
//
// Portée (baseline 433 pending) :
//   245 EXACT_SINGLE_PROPOSAL      → resolved / exact_single_proposal  (1 preuve chacune)
//   22  WHOLE_THREAD_PROVEN_SAFE   → resolved / whole_thread_proven_safe (jeu figé exact)
//   165 NEEDS_PROPOSAL_SCOPE       → INTOUCHÉ (reste unresolved/NULL)
//   1   STALE_PENDING              → INTOUCHÉ
//
// Idempotent : le writer refuse un rejeu avec un jeu de preuves différent, mais accepte un
// rejeu strictement identique (result=already_resolved). Ce script peut donc être relancé
// sans risque après un run partiel.

import * as fs from 'fs'
import 'dotenv/config'

const raw = fs.readFileSync('.env.local', 'utf8')
for (const rawLine of raw.split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/resolve_pending_trace_evidence`

async function resolve(pendingTraceId, proposalIds, evidenceBasis) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_pending_trace_id: pendingTraceId,
      p_proposal_ids: proposalIds,
      p_evidence_basis: evidenceBasis,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`RPC ${res.status} pending=${pendingTraceId}: ${JSON.stringify(body)}`)
  return body
}

async function main() {
  const r1 = JSON.parse(fs.readFileSync('scripts/_p6e3a-pending-trace-evidence-reconstruction-audit-report.json', 'utf8'))
  const r2 = JSON.parse(fs.readFileSync('scripts/_p6e3a1-whole-thread-condition-validation-audit-report.json', 'utf8'))

  const exactSingle = r1.allRows.filter((r) => r.category === 'EXACT_SINGLE_PROPOSAL')
  const provenSafe = r2.allRows.filter((r) => r.conditionCategory === 'WHOLE_THREAD_PROVEN_SAFE')

  if (exactSingle.length !== 245) throw new Error(`HARD STOP: attendu 245 EXACT_SINGLE_PROPOSAL, trouvé ${exactSingle.length}`)
  if (provenSafe.length !== 22) throw new Error(`HARD STOP: attendu 22 WHOLE_THREAD_PROVEN_SAFE, trouvé ${provenSafe.length}`)

  console.log(`=== Backfill 6E.3B.1 : ${exactSingle.length} exact_single_proposal + ${provenSafe.length} whole_thread_proven_safe ===`)

  let resolvedCount = 0
  let alreadyResolvedCount = 0
  const errors = []

  for (const row of exactSingle) {
    const proposalIds = row.evidenceScope.sourceProposalIds
    if (proposalIds.length !== 1) throw new Error(`HARD STOP: EXACT_SINGLE_PROPOSAL ${row.pendingTraceId} a ${proposalIds.length} propositions, attendu 1`)
    try {
      const result = await resolve(row.pendingTraceId, proposalIds, 'exact_single_proposal')
      if (result.result === 'resolved') resolvedCount++
      else if (result.result === 'already_resolved') alreadyResolvedCount++
    } catch (e) {
      errors.push({ pendingTraceId: row.pendingTraceId, category: 'exact_single_proposal', error: String(e.message) })
    }
  }

  for (const row of provenSafe) {
    const proposalIds = row.props.map((p) => p.id)
    if (proposalIds.length === 0) throw new Error(`HARD STOP: WHOLE_THREAD_PROVEN_SAFE ${row.pendingTraceId} a 0 proposition`)
    try {
      const result = await resolve(row.pendingTraceId, proposalIds, 'whole_thread_proven_safe')
      if (result.result === 'resolved') resolvedCount++
      else if (result.result === 'already_resolved') alreadyResolvedCount++
    } catch (e) {
      errors.push({ pendingTraceId: row.pendingTraceId, category: 'whole_thread_proven_safe', error: String(e.message) })
    }
  }

  console.log(`\nRésolus cette exécution : ${resolvedCount}`)
  console.log(`Déjà résolus (idempotence) : ${alreadyResolvedCount}`)
  console.log(`Erreurs : ${errors.length}`)
  if (errors.length > 0) {
    console.log(JSON.stringify(errors, null, 2))
    process.exit(1)
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
