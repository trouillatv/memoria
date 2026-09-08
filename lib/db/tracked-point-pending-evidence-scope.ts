// Phase 6E.3C.1 — productisation de la sélection humaine de portée de preuve (evidence scope),
// wrapper au-dessus de la RPC resolve_pending_trace_evidence (migration 394, déjà pilotée sur
// les 267 pending traces exact_single_proposal/whole_thread_proven_safe résolues en 6E.3B.1).
// Aucune migration 397 : la RPC 394 porte déjà l'écriture atomique (evidence_status,
// evidence_basis, tracked_point_pending_trace_evidence) et le trigger de garde de thread
// (proposal introuvable / hors thread) — ce module ajoute UNIQUEMENT ce que la RPC ne fait
// structurellement pas : (1) vérifier status='pending' (la RPC ignore ENTIÈREMENT cette colonne
// — une pending trace dismissed avec evidence_status encore 'unresolved' serait sinon résolue
// sans broncher), (2) rejeter les IDs de proposition dupliqués au lieu de les dédupliquer en
// silence (`array_agg(DISTINCT ...)` côté RPC), (3) traduire l'exception libre "déjà résolue
// avec un jeu de preuves différent" en code structuré EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE
// au lieu d'une chaîne brute, (4) le garde-fou SITE_MISMATCH que la RPC, SECURITY DEFINER sans
// notion d'appelant, ne peut pas porter (même convention que tracked-point-pending-resolution.ts).
//
// Geste humain modélisé (mandat Vincent) : PAS "il faut suivre ceci", PAS "cela résout ce
// Point" — seulement "dans ce thread, voici précisément les propositions qui constituent
// l'information dont MemorIA parle". evidence_basis est TOUJOURS 'human_selected' ici (les deux
// autres valeurs, exact_single_proposal/whole_thread_proven_safe, restent la provenance du
// backfill 6E.3B.1, jamais reproduite par un geste humain futur). Aucune règle de sélection
// automatique : même proposal_family, même label, même canonical_subject ne présélectionnent
// jamais rien — la liste proposalIds est TOUJOURS le choix exact et exhaustif de l'humain.
//
// Après résolution, la pending trace redevient automatiquement actionnable dans les files déjà
// existantes SANS synchronisation manuelle : loadPendingResolutionQueue (kind=
// RESOLUTION_WITHOUT_KNOWN_PROBLEM) recalcule targetingMode dès que evidence_status='resolved'
// (tracked-point-pending-resolution-queue.ts, inchangé) ; confirm_pending_trackability (kind=
// TRACKABILITY_UNDETERMINED, migration 395) lève déjà EVIDENCE_SCOPE_UNRESOLVED tant que
// evidence_status≠'resolved' et réussit dès que cette écriture est passée — ce module ne
// touche ni l'un ni l'autre, il ne fait que lever le verrou evidence_status en amont.

import { createAdminClient } from '@/lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResolvePendingEvidenceScopeResult =
  | {
      ok: true
      result: 'resolved' | 'already_resolved'
      pendingTraceId: string
      sourceThreadId: string
      evidenceBasis: 'human_selected'
      evidenceCount: number
    }
  | { ok: false; error: string }

// Traduction des exceptions Postgres brutes de la RPC 394 (et de son trigger de garde de
// thread) en codes structurés — un seul endroit connaît ce vocabulaire, ce tableau ne fait
// que le reconnaître. Ordre : du plus spécifique au plus générique.
const GUARD_MATCHERS: Array<{ code: string; test: (message: string) => boolean }> = [
  { code: 'PENDING_TRACE_NOT_FOUND', test: (m) => m.includes('pending trace introuvable') },
  { code: 'PROPOSAL_NOT_FOUND', test: (m) => m.includes('proposal_id') && m.includes('introuvable') },
  { code: 'PROPOSAL_NOT_IN_THREAD', test: (m) => m.includes("n'appartient pas au thread") },
  {
    code: 'EVIDENCE_ALREADY_RESOLVED_DIFFERENT_SCOPE',
    test: (m) => m.includes('déjà résolue avec un jeu de preuves différent'),
  },
]

function parseRpcError(message: string): string {
  const hit = GUARD_MATCHERS.find((g) => g.test(message))
  return hit ? hit.code : `UNKNOWN_ERROR: ${message}`
}

// resolvePendingEvidenceScope : "toujours recalculer live" — relit status/site à chaque appel,
// n'accepte jamais un état précalculé par l'écran. Appelle la RPC exactement une fois par
// invocation (pas de pré-lecture de l'evidence existante : la RPC 394, sous verrou FOR UPDATE,
// est déjà l'unique source de vérité pour already_resolved vs. différent).
export async function resolvePendingEvidenceScope(params: {
  siteId: string
  pendingTraceId: string
  proposalIds: string[]
}): Promise<ResolvePendingEvidenceScopeResult> {
  const { siteId, pendingTraceId, proposalIds } = params
  const db = createAdminClient()

  if (!UUID_RE.test(pendingTraceId)) return { ok: false, error: 'INVALID_PENDING_TRACE_ID' }
  if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
    return { ok: false, error: 'INVALID_PROPOSAL_IDS_EMPTY' }
  }
  if (proposalIds.some((id) => !UUID_RE.test(id))) return { ok: false, error: 'INVALID_PROPOSAL_IDS_FORMAT' }
  const uniqueIds = new Set(proposalIds)
  if (uniqueIds.size !== proposalIds.length) return { ok: false, error: 'INVALID_PROPOSAL_IDS_DUPLICATE' }

  const { data: pendingRow, error: pendingErr } = await db
    .from('tracked_point_pending_trace')
    .select('id, site_id, status, source_thread_id')
    .eq('id', pendingTraceId)
    .maybeSingle()
  if (pendingErr) throw pendingErr
  if (!pendingRow) return { ok: false, error: 'PENDING_TRACE_NOT_FOUND' }
  if (pendingRow.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }
  // La RPC 394 ignore entièrement cette colonne — seul ce wrapper empêche de résoudre une
  // portée de preuve sur une pending trace abandonnée (dismissed) ou déjà associée (resolved
  // via associate_pending_resolution_to_point / confirm_pending_trackability).
  if (pendingRow.status !== 'pending') return { ok: false, error: 'INVALID_STATUS' }

  const { data, error } = await db.rpc('resolve_pending_trace_evidence', {
    p_pending_trace_id: pendingTraceId,
    p_proposal_ids: proposalIds,
    p_evidence_basis: 'human_selected',
  })
  if (error) return { ok: false, error: parseRpcError(error.message) }

  const result = data as { result: 'resolved' | 'already_resolved'; evidenceCount: number }
  return {
    ok: true,
    result: result.result,
    pendingTraceId,
    sourceThreadId: pendingRow.source_thread_id,
    evidenceBasis: 'human_selected',
    evidenceCount: result.evidenceCount,
  }
}
