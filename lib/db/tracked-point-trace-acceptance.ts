// Phase 6E.2B — pilote réel TRACE_TO_POINT, wrapper au-dessus de la RPC accept_trace_identity_candidate
// (migration 393).
//
// Mandat Vincent : UN SEUL candidat par appel, jamais un traitement en masse. La RPC porte les
// guards structurels/concurrentiels (existence, statuts, site, CONFLICTED, dérive vers un autre
// point, idempotence). Ce wrapper porte la SEULE chose que la RPC ne doit pas coder en dur :
// la revalidation LIVE de SAFE_SINGLE_TRACE_THREAD (homogénéité de famille documentaire), via
// classifyTraceIdentityCandidate (lib/knowledge/tracked-point-trace-scope.ts) — la même fonction
// que 6E.2A, jamais une copie. "87 safe au 08/09" est un instantané, pas une garantie éternelle :
// chaque appel revalide depuis l'état DB courant, jamais depuis un rapport figé.
//
// Si le candidat n'est plus 'pending' (déjà accepted/rejected), la classification live n'a plus
// de sens — l'appel passe directement à la RPC, dont les propres guards (status, idempotence)
// décident.
//
// Round 7 (migration 402) : la RPC ferme désormais aussi, dans la même transaction, l'éventuel
// tracked_point_pending_trace(kind='IDENTITY_UNRESOLVED', status='pending') du même thread —
// ce wrapper se contente de relayer identityPendingTraceResolved/identityPendingTraceId, sans
// logique supplémentaire (la RPC porte tout le guard, cf. migration 402).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  classifyTraceIdentityCandidate,
  type TraceScopePointRow,
  type TraceScopeMemberRow,
} from '@/lib/knowledge/tracked-point-trace-scope'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AcceptTraceIdentityCandidateResult =
  | {
      ok: true
      alreadyAssociated: true
      targetPointId: string
      sourceThreadId: string
      memberId: string
      identityPendingTraceResolved: boolean
      identityPendingTraceId: string | null
    }
  | {
      ok: true
      alreadyAssociated: false
      targetPointId: string
      sourceThreadId: string
      memberId: string
      identityPendingTraceResolved: boolean
      identityPendingTraceId: string | null
    }
  | { ok: false; error: string }

// acceptTraceIdentityCandidate : revalide live la classification (candidat encore pending
// uniquement) puis appelle EXACTEMENT UNE FOIS la RPC. N'accepte jamais une classification
// autre que SAFE_SINGLE_TRACE_THREAD sans écriture — ALREADY_ASSOCIATED est également transmis
// à la RPC (dont le guard d'idempotence renvoie le résultat déjà posé, jamais une 2e ligne).
export async function acceptTraceIdentityCandidate(params: {
  siteId: string
  candidateId: string
}): Promise<AcceptTraceIdentityCandidateResult> {
  const db = createAdminClient()
  const { siteId, candidateId } = params

  if (!UUID_RE.test(candidateId)) {
    return { ok: false, error: 'INVALID_CANDIDATE_ID' }
  }

  const { data: candidateRow, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, candidate_point_id, subject_thread_id, scope, status, created_at')
    .eq('id', candidateId)
    .maybeSingle()
  if (candErr) throw candErr
  if (!candidateRow) return { ok: false, error: 'CANDIDATE_NOT_FOUND' }
  if (candidateRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }

  if (candidateRow.status === 'pending') {
    const { data: rawPoints, error: pointsErr } = await db
      .from('tracked_point')
      .select('id, site_id, status, merged_into_id, founding_kind, founding_reference, created_at')
      .eq('site_id', siteId)
    if (pointsErr) throw pointsErr

    const points: TraceScopePointRow[] = (rawPoints ?? []).map((p) => ({
      id: p.id,
      siteId: p.site_id,
      status: p.status,
      mergedIntoId: p.merged_into_id,
      foundingKind: p.founding_kind,
      foundingReference: p.founding_reference,
      createdAt: p.created_at,
    }))

    const pointIds = points.map((p) => p.id)
    const { data: rawMembers, error: memErr } = await db
      .from('tracked_point_member')
      .select('tracked_point_id, subject_thread_id, scope, status, created_at')
      .in('tracked_point_id', pointIds.length > 0 ? pointIds : [NIL_UUID])
    if (memErr) throw memErr

    const members: TraceScopeMemberRow[] = (rawMembers ?? []).map((m) => ({
      trackedPointId: m.tracked_point_id,
      subjectThreadId: m.subject_thread_id,
      scope: (m.scope ?? 'thread') as TraceScopeMemberRow['scope'],
      status: m.status as TraceScopeMemberRow['status'],
      createdAt: m.created_at,
    }))

    const { data: proposalRows, error: propErr } = await db
      .from('document_extraction_proposal')
      .select('proposal_family')
      .eq('subject_thread_id', candidateRow.subject_thread_id)
    if (propErr) throw propErr
    const famillesPresentes = [...new Set((proposalRows ?? []).map((p) => p.proposal_family))]

    const classification = classifyTraceIdentityCandidate(
      {
        id: candidateRow.id,
        siteId: candidateRow.site_id,
        candidatePointId: candidateRow.candidate_point_id,
        subjectThreadId: candidateRow.subject_thread_id,
        scope: candidateRow.scope,
        createdAt: candidateRow.created_at,
      },
      points,
      members,
      famillesPresentes,
    )

    if (classification.category !== 'SAFE_SINGLE_TRACE_THREAD' && classification.category !== 'ALREADY_ASSOCIATED') {
      return {
        ok: false,
        error: `NOT_SAFE_SINGLE_TRACE_THREAD: ${classification.category}${classification.blockerReason ? ` — ${classification.blockerReason}` : ''}`,
      }
    }
  }

  const { data, error } = await db.rpc('accept_trace_identity_candidate', { p_candidate_id: candidateId })
  if (error) return { ok: false, error: error.message }

  const result = data as {
    candidateId: string
    alreadyAssociated: boolean
    targetPointId: string
    sourceThreadId: string
    memberId: string
    membershipInserted: boolean
    identityPendingTraceResolved: boolean
    identityPendingTraceId: string | null
  }

  return {
    ok: true,
    alreadyAssociated: result.alreadyAssociated,
    targetPointId: result.targetPointId,
    sourceThreadId: result.sourceThreadId,
    memberId: result.memberId,
    identityPendingTraceResolved: result.identityPendingTraceResolved,
    identityPendingTraceId: result.identityPendingTraceId,
  } as AcceptTraceIdentityCandidateResult
}

export type RejectTraceIdentityCandidateResult =
  | { ok: true; alreadyResolved: boolean; candidateId: string }
  | { ok: false; error: string }

// rejectTraceIdentityCandidate : décision humaine "pas ce Point" pour EXACTEMENT le candidat
// désigné — jamais ses éventuels frères (même source, autre target). Phase 6E.2C, Build 3 :
// contrairement à l'acceptation (migration 393, RPC transactionnelle avec insertion de
// membership), un rejet ne touche que la ligne candidate elle-même — zéro membership, zéro
// effet reducer. Un simple UPDATE mono-ligne gardé par `WHERE status='pending'` est atomique
// par construction (pas de RPC/migration nécessaire ici, à la différence de l'acceptation) :
// un appelant concurrent qui perd la course affecte 0 ligne, jamais une double écriture.
//
// Rejeter un candidat déjà ACCEPTED est un échec explicite, jamais un no-op silencieux : la
// membership existante n'est pas remise en cause par ce module (aucun effet sur le reducer).
export async function rejectTraceIdentityCandidate(params: {
  siteId: string
  candidateId: string
  actorUserId: string
}): Promise<RejectTraceIdentityCandidateResult> {
  const db = createAdminClient()
  const { siteId, candidateId, actorUserId } = params

  if (!UUID_RE.test(candidateId)) {
    return { ok: false, error: 'INVALID_CANDIDATE_ID' }
  }

  const { data: candidateRow, error: candErr } = await db
    .from('tracked_point_identity_candidate')
    .select('id, site_id, status')
    .eq('id', candidateId)
    .maybeSingle()
  if (candErr) throw candErr
  if (!candidateRow) return { ok: false, error: 'CANDIDATE_NOT_FOUND' }
  if (candidateRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }
  if (candidateRow.status === 'rejected') return { ok: true, alreadyResolved: true, candidateId }
  if (candidateRow.status === 'accepted') {
    return { ok: false, error: 'ALREADY_ACCEPTED: candidate a déjà une membership associée, rejet impossible' }
  }

  const { data: updated, error: updErr } = await db
    .from('tracked_point_identity_candidate')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: actorUserId })
    .eq('id', candidateId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (updated) return { ok: true, alreadyResolved: false, candidateId }

  // Course perdue entre le SELECT et l'UPDATE gardé (0 ligne affectée ne peut venir que d'un
  // autre appel ayant fait sortir le candidat de 'pending' entre-temps) : ne jamais deviner
  // l'issue, relire l'état réel avant de répondre.
  const { data: afterRace, error: raceErr } = await db
    .from('tracked_point_identity_candidate')
    .select('status')
    .eq('id', candidateId)
    .single()
  if (raceErr) throw raceErr
  if (afterRace.status === 'rejected') return { ok: true, alreadyResolved: true, candidateId }
  return {
    ok: false,
    error: `ALREADY_ACCEPTED: candidate status=${afterRace.status} après course concurrente, rejet impossible`,
  }
}
