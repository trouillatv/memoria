import 'server-only'

// Résolution d'une référence textuelle libre vers un canonical_subject.
//
// Doctrine :
//   1. Exact normalized match (label ou alias) → resolved si unique
//   2. Technical code filter + Jaccard → resolved si gagnant clair, ambiguous sinon
//   3. Jaccard seul (pas de code) → resolved si unique au-dessus du seuil
//   4. not_found si aucun candidat plausible
//
// Le LLM ne tranche JAMAIS entre plusieurs candidats crédibles.
// En cas d'ambiguïté, la UI doit demander à l'utilisateur de choisir.

import { createAdminClient } from '@/lib/supabase/admin'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'
import { extractTechnicalCodes } from '@/lib/documents/semantic-subject-resolution'

export type CanonicalSubjectCandidate = {
  id: string
  label: string
}

export type SubjectResolutionResult =
  | { kind: 'resolved'; candidate: CanonicalSubjectCandidate }
  | { kind: 'ambiguous'; candidates: CanonicalSubjectCandidate[] }
  | { kind: 'not_found' }

/**
 * Normalise un texte pour la comparaison exacte :
 * minuscules → suppression diacritiques → alphanumériques + espaces → trim.
 * Pas de filtrage stopwords (contrairement à normalizeLabel) pour préserver
 * les cas où le mot est discriminant dans le contexte chantier.
 */
export function normalizeCanonicalLabel(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type ScoredCandidate = { id: string; label: string; score: number }

function scoreSubject(
  queryText: string,
  label: string,
  aliases: string[],
): number {
  const allLabels = [label, ...aliases]
  return Math.max(...allLabels.map((l) => jaccardSimilarity(queryText, l)))
}

/**
 * Résout une référence textuelle libre (ex : "G3", "Regard R4") vers un
 * ou plusieurs canonical_subjects actifs du chantier.
 *
 * La validation que l'utilisateur a accès au siteId est portée par la couche appelante.
 */
export async function resolveCanonicalSubjectReference(
  siteId: string,
  queryText: string,
): Promise<SubjectResolutionResult> {
  const supabase = createAdminClient()

  const { data: subjects } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases')
    .eq('site_id', siteId)
    .eq('status', 'active')

  if (!subjects || subjects.length === 0) return { kind: 'not_found' }

  const normalized = normalizeCanonicalLabel(queryText)
  const queryCodes = extractTechnicalCodes(queryText)

  // ── Pass 1 : correspondance exacte normalisée (label ou alias) ────────────────
  const exactMatches = subjects.filter((s) => {
    if (normalizeCanonicalLabel(s.label) === normalized) return true
    const aliases: string[] = s.aliases ?? []
    return aliases.some((a) => normalizeCanonicalLabel(a) === normalized)
  })

  if (exactMatches.length === 1) {
    return { kind: 'resolved', candidate: { id: exactMatches[0].id, label: exactMatches[0].label } }
  }
  if (exactMatches.length > 1) {
    return { kind: 'ambiguous', candidates: exactMatches.map((s) => ({ id: s.id, label: s.label })) }
  }

  // ── Pass 2 : code technique → Jaccard parmi les candidats avec code commun ────
  if (queryCodes.size > 0) {
    const codeMatches: ScoredCandidate[] = subjects
      .filter((s) => {
        const allText = [s.label, ...(s.aliases ?? [])].join(' ')
        const candidateCodes = extractTechnicalCodes(allText)
        for (const code of queryCodes) {
          if (candidateCodes.has(code)) return true
        }
        return false
      })
      .map((s) => ({
        id: s.id,
        label: s.label,
        score: scoreSubject(queryText, s.label, s.aliases ?? []),
      }))
      .sort((a, b) => b.score - a.score)

    if (codeMatches.length === 1) {
      return { kind: 'resolved', candidate: { id: codeMatches[0].id, label: codeMatches[0].label } }
    }

    if (codeMatches.length > 1) {
      // Gagnant clair : premier ≥ 0.50 ET second < 0.20 (large écart)
      if (codeMatches[0].score >= 0.50 && codeMatches[1].score < 0.20) {
        return { kind: 'resolved', candidate: { id: codeMatches[0].id, label: codeMatches[0].label } }
      }

      // Ambiguïté : montrer les candidats pertinents (score ≥ 0.10, max 5)
      const relevant = codeMatches.filter((s) => s.score >= 0.10).slice(0, 5)
      return {
        kind: 'ambiguous',
        candidates: (relevant.length > 0 ? relevant : codeMatches.slice(0, 3))
          .map((s) => ({ id: s.id, label: s.label })),
      }
    }
    // 0 code matches → continuer en Pass 3
  }

  // ── Pass 3 : Jaccard seul (seuil élevé — pas de code pour discriminer) ────────
  const JACCARD_THRESHOLD = 0.35
  const jaccardMatches: ScoredCandidate[] = subjects
    .map((s) => ({
      id: s.id,
      label: s.label,
      score: scoreSubject(queryText, s.label, s.aliases ?? []),
    }))
    .filter((s) => s.score >= JACCARD_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (jaccardMatches.length === 0) return { kind: 'not_found' }
  if (jaccardMatches.length === 1) {
    return { kind: 'resolved', candidate: { id: jaccardMatches[0].id, label: jaccardMatches[0].label } }
  }

  // Gagnant clair en Jaccard seul : premier ≥ 0.70 et second reste sous le seuil
  if (jaccardMatches[0].score >= 0.70 && jaccardMatches[1].score < JACCARD_THRESHOLD) {
    return { kind: 'resolved', candidate: { id: jaccardMatches[0].id, label: jaccardMatches[0].label } }
  }

  return {
    kind: 'ambiguous',
    candidates: jaccardMatches.slice(0, 5).map((s) => ({ id: s.id, label: s.label })),
  }
}
