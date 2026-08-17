import 'server-only'

// Résolution d'une référence textuelle libre vers un canonical_subject.
//
// Doctrine (passes, appliquées à un pool de sujets — cf. matchCanonicalSubjects) :
//   1. Exact normalized match (label ou alias) → resolved si unique
//   2. Technical code filter + Jaccard → resolved si gagnant clair, ambiguous sinon
//   3. Jaccard seul (pas de code) → resolved si unique au-dessus du seuil
//   4. not_found si aucun candidat plausible
//
// P4-D1.1 : ces passes tournent d'abord sur le pool 'active' seul ; le pool
// 'auto_archived' n'est consulté qu'en repli si le pool actif ne trouve rien
// (cf. resolveCanonicalSubjectReference).
//
// Le LLM ne tranche JAMAIS entre plusieurs candidats crédibles.
// En cas d'ambiguïté, la UI doit demander à l'utilisateur de choisir.

import { createAdminClient } from '@/lib/supabase/admin'
import { jaccardSimilarity, strongContainmentMatch } from '@/lib/documents/subject-reconciliation'
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

type SubjectRow = { id: string; label: string; aliases: string[] | null }

/**
 * Ancrage lexical discriminant (P4-A.1, 2026-08-17) : un terme court parlé
 * naturellement ("cadenas", "portail") est mécaniquement pénalisé par Jaccard
 * face à un label canonique long ("Accès sécurisé au chantier (portail et
 * cadenas à code)") — le ratio d'intersection s'effondre avec la taille du
 * label, pas avec la pertinence sémantique.
 *
 * strongContainmentMatch() (déjà utilisée pour réconcilier les threads de
 * sujets entre PV) porte déjà la bonne garde : un token isolé n'est accepté
 * comme discriminant que s'il fait ≥ 7 caractères et n'est pas un mot trop
 * générique (GENERIC_TOKENS). Ici, la sûreté vient du COMPTAGE de sujets
 * distincts touchés plutôt que d'un score : un seul sujet touché → résolution
 * certaine ; plusieurs → collision, jamais tranchée automatiquement (ex.
 * "planning" ou "matériel" partagés par plusieurs sujets du même chantier).
 *
 * Exportée pour les tests unitaires (pas d'appel DB).
 */
export function findLexicalAnchorMatches(
  queryText: string,
  subjects: SubjectRow[],
): CanonicalSubjectCandidate[] {
  return subjects
    .filter((s) => {
      const allTexts = [s.label, ...(s.aliases ?? [])]
      return allTexts.some((t) => strongContainmentMatch(queryText, t))
    })
    .map((s) => ({ id: s.id, label: s.label }))
}

// Réactive un canonical_subject auto_archived → active.
// Guard WHERE status='auto_archived' : idempotent, ne touche jamais merged/split.
async function reactivateCanonicalSubject(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<void> {
  await supabase
    .from('canonical_subject')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('status', 'auto_archived')
}

// Seul statut réactivable automatiquement — jamais merged, split, ou autre terminal.
export function canReactivate(status: string): boolean {
  return status === 'auto_archived'
}

/**
 * Applique les 4 passes de résolution (exact → ancrage lexical → code
 * technique → Jaccard) à UN pool de sujets donné. Pure, aucun accès DB, aucun
 * effet de bord (pas de réactivation) : c'est resolveCanonicalSubjectReference
 * qui décide, selon le statut du pool, si le résultat doit déclencher une
 * réactivation.
 *
 * Exportée pour les tests unitaires.
 */
export function matchCanonicalSubjects(
  queryText: string,
  subjects: SubjectRow[],
): SubjectResolutionResult {
  if (subjects.length === 0) return { kind: 'not_found' }

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

  // ── Pass 1.5 : ancrage lexical discriminant (containment, cf. findLexicalAnchorMatches) ──
  const anchorMatches = findLexicalAnchorMatches(queryText, subjects)

  if (anchorMatches.length === 1) {
    return { kind: 'resolved', candidate: { id: anchorMatches[0].id, label: anchorMatches[0].label } }
  }
  if (anchorMatches.length > 1) {
    return { kind: 'ambiguous', candidates: anchorMatches }
  }
  // 0 ancrage → continuer vers Pass 2 (code technique) puis Pass 3 (Jaccard)

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

/**
 * Résout une référence textuelle libre (ex : "G3", "Regard R4") vers un
 * canonical_subject du chantier.
 *
 * P4-D1.1 (2026-08-17) : résolution à DEUX niveaux, active en priorité.
 *   1. Les 4 passes tournent d'abord UNIQUEMENT sur les sujets 'active'. Un
 *      sujet 'auto_archived' n'entre jamais en collision avec un sujet actif
 *      portant le même libellé — ce n'est plus une ambiguïté artificielle.
 *   2. Seulement si le pool actif ne produit aucune correspondance
 *      (not_found), les mêmes passes, mêmes seuils, tournent sur le pool
 *      'auto_archived'. Un résultat 'resolved' déclenche alors la
 *      réactivation explicite du sujet avant retour — c'est le SEUL chemin de
 *      réactivation, volontairement préservé.
 *
 * Aucun seuil n'est modifié, aucune logique d'ancrage lexical n'est touchée :
 * seul l'ORDRE d'exposition des pools change.
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
    .select('id, label, aliases, status')
    .eq('site_id', siteId)
    .in('status', ['active', 'auto_archived'])

  if (!subjects || subjects.length === 0) return { kind: 'not_found' }

  const activeSubjects = subjects.filter((s) => s.status === 'active')
  const archivedSubjects = subjects.filter((s) => s.status === 'auto_archived')

  // ── Niveau 1 : résolution courante, sujets actifs uniquement ──────────────────
  const activeResult = matchCanonicalSubjects(queryText, activeSubjects)
  if (activeResult.kind !== 'not_found') return activeResult

  // ── Niveau 2 : repli explicite sur les sujets archivés → réactivation ─────────
  const archivedResult = matchCanonicalSubjects(queryText, archivedSubjects)
  if (archivedResult.kind === 'resolved') {
    await reactivateCanonicalSubject(supabase, archivedResult.candidate.id)
  }
  return archivedResult
}
