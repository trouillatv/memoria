import 'server-only'

// P1-C2b — Rapprochement sémantique inter-années, DERNIER RECOURS et pool BORNÉ.
//
// Ne remplace aucun mécanisme existant. S'exécute uniquement après l'échec des phases
// fortes (déterministe → LLM liste fermée → P0-1/P0-2 lexical), pour les threads MÉTIER qui
// s'apprêteraient à créer un nouveau sujet. Réutilise le juge existant analyzeSubjectPair
// (verdict fermé same_subject|related|distinct|uncertain) — on ne crée pas de second moteur.
//
// Doctrine : favoriser le faux négatif au faux positif. Fusion (rattachement) UNIQUEMENT si un
// same_subject unique et fiable ; ambiguïté ou domaine partagé mais objet distinct → aucun
// rattachement (le sujet sera créé). Aucun embedding (Option B différée jusqu'à preuve Géant).

import { analyzeSubjectPair, type SubjectInput } from '@/lib/subjects/similarity-analyze'

export const SEMANTIC_POOL_CAP = 20     // cap dur : au-delà, skip + log (jamais de boucle non bornée)
export const SEMANTIC_MIN_SCORE = 70    // confiance minimale pour accepter un same_subject
export const SEMANTIC_MARGIN = 10       // marge d'unicité entre le 1er et le 2e same_subject

export interface SemanticCandidate {
  id: string
  label: string
  aliases?: string[]
  occurrenceContext?: string | null
}

// ── Pures (testables sans DB ni LLM) ──────────────────────────────────────────

/**
 * Pool de candidats borné. Le préfiltre acteur/inactif est fait en amont (existingCs déjà
 * filtré kind<>actor, status=active). Ici : exclut le sujet lui-même, applique le cap dur.
 * Au-delà du cap → skip (pool vide, skipped=true) : on préfère ne rien faire qu'appeler le
 * juge sur un pool non maîtrisé.
 */
export function buildSemanticCandidatePool(
  selfId: string | null,
  candidates: SemanticCandidate[],
  cap: number = SEMANTIC_POOL_CAP,
): { pool: SemanticCandidate[]; skipped: boolean } {
  const filtered = candidates.filter((c) => c.id !== selfId)
  if (filtered.length > cap) return { pool: [], skipped: true }
  return { pool: filtered, skipped: false }
}

/**
 * Contexte métier compact et déterministe d'un sujet, tiré de ses occurrences (labels + notes).
 * Dédupliqué, tronqué. Donne au juge la matière pour conclure sur l'OBJET (pas juste le libellé).
 */
export function buildSubjectSemanticContext(
  labels: Array<string | null | undefined>,
  notes: Array<string | null | undefined>,
  maxChars = 400,
): string {
  const seen = new Set<string>()
  const parts = [...labels, ...notes]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
  return parts.join(' — ').slice(0, maxChars)
}

export type SemanticVerdictRow = { candidateId: string; verdict: string; score: number }

/**
 * Décide le match final — favorise le faux négatif.
 * Rattache SEULEMENT si un same_subject unique atteint minScore ; si plusieurs same_subject,
 * exige une marge nette sur le second, sinon ambigu → aucun match.
 */
export function decideSemanticMatch(
  rows: SemanticVerdictRow[],
  opts: { minScore?: number; margin?: number } = {},
): { matchId: string | null; reason: string } {
  const minScore = opts.minScore ?? SEMANTIC_MIN_SCORE
  const margin = opts.margin ?? SEMANTIC_MARGIN
  const same = rows
    .filter((r) => r.verdict === 'same_subject' && r.score >= minScore)
    .sort((a, b) => b.score - a.score)
  if (same.length === 0) return { matchId: null, reason: 'no_same_subject' }
  if (same.length === 1) return { matchId: same[0].candidateId, reason: 'unique_same_subject' }
  if (same[0].score - same[1].score >= margin) return { matchId: same[0].candidateId, reason: 'clear_winner' }
  return { matchId: null, reason: 'ambiguous_multiple_same_subject' }
}

// ── Orchestration (appelle le juge LLM) ───────────────────────────────────────

export interface SemanticFallbackResult {
  matchId: string | null
  evaluated: number
  judgeCalls: number
  skipped: boolean
  reason: string
  verdicts: SemanticVerdictRow[]
}

// Injectable pour les tests : signature du juge réellement utilisée ici.
export type JudgeFn = (
  a: SubjectInput,
  b: SubjectInput,
  userId: string | null,
  opts?: { fusionWarningReason?: string | null },
) => Promise<{ verdict: string; score: number }>

const CAUTION =
  'Ne conclus same_subject que si les deux décrivent le MÊME objet physique/opération, pas seulement le même domaine.'

/**
 * Dernier recours : juge chaque candidat borné, décide un match unique fiable ou rien.
 * `judge` par défaut = analyzeSubjectPair ; injectable pour tests déterministes.
 */
export async function resolveSemanticFallback(
  source: SemanticCandidate,
  candidatesRaw: SemanticCandidate[],
  judge: JudgeFn = analyzeSubjectPair,
  cap: number = SEMANTIC_POOL_CAP,
): Promise<SemanticFallbackResult> {
  const { pool, skipped } = buildSemanticCandidatePool(source.id, candidatesRaw, cap)
  if (skipped) {
    return { matchId: null, evaluated: candidatesRaw.length, judgeCalls: 0, skipped: true, reason: 'pool_over_cap', verdicts: [] }
  }
  if (pool.length === 0) {
    return { matchId: null, evaluated: 0, judgeCalls: 0, skipped: false, reason: 'empty_pool', verdicts: [] }
  }

  const a: SubjectInput = { id: source.id, label: source.label, aliases: source.aliases ?? [], occurrenceContext: source.occurrenceContext ?? null }
  const verdicts: SemanticVerdictRow[] = []
  let judgeCalls = 0
  for (const cand of pool) {
    const b: SubjectInput = { id: cand.id, label: cand.label, aliases: cand.aliases ?? [], occurrenceContext: cand.occurrenceContext ?? null }
    try {
      const r = await judge(a, b, null, { fusionWarningReason: CAUTION })
      judgeCalls++
      verdicts.push({ candidateId: cand.id, verdict: r.verdict, score: r.score })
    } catch {
      // échec juge sur un candidat → ignoré (favorise le faux négatif)
    }
  }
  const decision = decideSemanticMatch(verdicts)
  return { matchId: decision.matchId, evaluated: pool.length, judgeCalls, skipped: false, reason: decision.reason, verdicts }
}
