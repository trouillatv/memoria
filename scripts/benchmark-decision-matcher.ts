/**
 * benchmark-decision-matcher.ts
 *
 * Matcher robuste pour le benchmark extraction "decision".
 * Remplace le protocole slice(0,50) du run gelé.
 *
 * Algorithme : coefficient d'overlap sur tokens normalisés, avec pré-filtres
 * document + famille + page. Seuil 0.50, bande AMBIGUOUS 0.33–0.50.
 *
 * Références :
 *   - docs/decision-micro-correctif-run/MATCHER-ALGORITHM.md
 *   - docs/decision-micro-correctif-run/MATCHER-MINI-GROUND-TRUTH.md
 *
 * ATTENTION : ce script est un outil de benchmark uniquement.
 * Il ne touche à aucun fichier de production (moteur d'extraction, prompts, etc.).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatchFamily = 'decision' | 'reservation' | 'knowledge_fact' | 'action' | 'company' | string

export interface ReferenceElement {
  id: string
  family: MatchFamily
  page: number | null
  excerpt: string
  summary?: string
}

export interface ExtractedElement {
  corpusId: string
  family: MatchFamily
  page?: number | null
  /** Texte source extrait (peut être vide dans certains runs gelés) */
  sourceExcerpt?: string
  /** Label court de substitution quand sourceExcerpt est vide */
  label?: string
}

export type MatchVerdict =
  | 'MATCHED'               // overlap ≥ 0.50, familles compatibles
  | 'MATCHED_BORDERLINE'    // overlap ≥ 0.50, famille extraction = reservation (frontière)
  | 'AMBIGUOUS_MATCH'       // 0.33 ≤ overlap < 0.50 — arbitrage humain obligatoire
  | 'MISSED'                // overlap < 0.33, ou aucun candidat du même document

export interface MatchResult {
  ref: ReferenceElement
  refCorpusId: string
  verdict: MatchVerdict
  bestCandidate?: ExtractedElement
  overlapScore: number
  jaccardScore: number
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Mots-outils français retirés de la comparaison pour réduire le bruit.
 * Liste minimale — on préfère conserver les tokens porteurs de sens.
 */
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'et', 'en', 'un', 'une',
  'au', 'aux', 'ce', 'se', 'que', 'qui', 'ou', 'par', 'sur', 'dans',
  'il', 'elle', 'ils', 'elles', 'nous', 'vous', 'y', 'a',
])

/**
 * Normalise un texte pour la comparaison lexicale :
 * 1. Minuscules
 * 2. Suppression des accents (NFD → retrait des diacritiques)
 * 3. Suppression de la ponctuation
 * 4. Collapse des espaces multiples
 * 5. Tokenisation
 * 6. Retrait des mots-outils
 * 7. Retrait du préfixe « Rappel : » (variation de forme courante dans les PV)
 *
 * @returns Tableau de tokens normalisés uniques (Set-like pour le scoring)
 */
export function normalizeAndTokenize(text: string): string[] {
  if (!text || text.trim() === '') return []

  let s = text.toLowerCase()

  // Retirer le préfixe "Rappel : " ou "Rappel:" qui n'apporte pas de signal
  s = s.replace(/^rappel\s*:\s*/i, '')

  // NFD → retrait des diacritiques (accents)
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')

  // Supprimer la ponctuation (garder les lettres, chiffres, espaces)
  s = s.replace(/[^a-z0-9\s]/g, ' ')

  // Collapse des espaces
  s = s.replace(/\s+/g, ' ').trim()

  // Tokenisation et retrait des mots-outils
  const tokens = s.split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t))

  return tokens
}

// ── Métriques ─────────────────────────────────────────────────────────────────

/**
 * Calcule le coefficient d'overlap et le Jaccard entre deux listes de tokens.
 *
 * overlap = |intersection| / min(|A|, |B|)
 *   → tolère qu'une moitié soit omise (cas JAR-E61 : première moitié absente du FP)
 *
 * jaccard = |intersection| / |union|
 *   → indicateur secondaire, utile pour départager deux candidats à overlap égal
 */
export function computeScores(
  tokensA: string[],
  tokensB: string[],
): { overlap: number; jaccard: number } {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { overlap: 0, jaccard: 0 }
  }

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  const intersectionSize = [...setA].filter(t => setB.has(t)).length
  const unionSize = new Set([...setA, ...setB]).size
  const minSize = Math.min(setA.size, setB.size)

  const overlap = minSize === 0 ? 0 : intersectionSize / minSize
  const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize

  return { overlap, jaccard }
}

// ── Compatibilité de famille ───────────────────────────────────────────────────

/**
 * Détermine si la famille d'un extrait extrait est compatible avec la famille
 * de la référence pour le matching decision.
 *
 * Règles :
 *   - decision ↔ decision : OK (exact)
 *   - decision ↔ reservation : OK mais marque BORDERLINE (frontière connue)
 *   - decision ↔ knowledge_fact : OK seulement si le texte de l'extrait contient
 *     un verbe d'arbitrage (« acté », « validé », « décidé », etc.)
 *   - decision ↔ autres : incompatible
 *
 * Rationale : le cas LRM-E38 (decision) vs FP « pierres de l'assise » (reservation)
 * donne overlap 0.50 mais doit être écarté — le filtre famille route ce FP vers E71
 * (reservation ref), pas vers E38 (decision ref).
 */
export function isFamilyCompatible(
  refFamily: MatchFamily,
  extFamily: MatchFamily,
  extText: string,
): { compatible: boolean; borderline: boolean } {
  if (refFamily !== 'decision') {
    // Ce matcher est uniquement pour les refs decision
    return { compatible: false, borderline: false }
  }

  if (extFamily === 'decision') {
    return { compatible: true, borderline: false }
  }

  if (extFamily === 'reservation') {
    // Frontière connue : reservation peut capter des décisions conditionnelles
    return { compatible: true, borderline: true }
  }

  if (extFamily === 'knowledge_fact') {
    // Absorption : KF → decision seulement si le texte contient un verbe d'arbitrage
    const ARBITRAGE_VERBS = ['acte', 'valide', 'decide', 'decision', 'arbitre', 'retenu', 'retenue']
    const normalized = extText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const hasArbitrage = ARBITRAGE_VERBS.some(v => normalized.includes(v))
    return { compatible: hasArbitrage, borderline: false }
  }

  // action, company, person, deadline, observation → incompatible
  return { compatible: false, borderline: false }
}

// ── Constantes de seuil ───────────────────────────────────────────────────────

/** Seuil minimal pour un match automatique (validé par mini ground truth) */
export const THRESHOLD_MATCH = 0.50

/** Borne basse de la zone d'arbitrage manuel */
export const THRESHOLD_AMBIG_LOW = 0.33

// ── Matcher principal ─────────────────────────────────────────────────────────

/**
 * Sélectionne le texte à comparer pour un extrait extrait.
 * Fallback sur `label` quand `sourceExcerpt` est vide (cas JAR run gelé).
 */
function getExtractText(ext: ExtractedElement): string {
  if (ext.sourceExcerpt && ext.sourceExcerpt.trim() !== '') {
    return ext.sourceExcerpt
  }
  return ext.label ?? ''
}

/**
 * Apparie une référence decision à la meilleure extraction du même document.
 *
 * Pipeline :
 *   1. Filtre corpus (même document obligatoire)
 *   2. Filtre famille compatible
 *   3. Filtre page (±1 pour les chunks à cheval)
 *   4. Score overlap sur tokens normalisés
 *   5. Verdict selon seuils
 *
 * @param ref - Élément de référence (family = 'decision')
 * @param refCorpusId - Identifiant du corpus de la référence (ex: "LRM_CR04")
 * @param extractedList - Liste de toutes les extractions (tous documents)
 * @returns Résultat de match avec verdict et scores
 */
export function matchDecisionRef(
  ref: ReferenceElement,
  refCorpusId: string,
  extractedList: ExtractedElement[],
): MatchResult {
  const refTokens = normalizeAndTokenize(ref.excerpt)

  let bestCandidate: ExtractedElement | undefined
  let bestOverlap = 0
  let bestJaccard = 0
  let bestBorderline = false

  for (const ext of extractedList) {
    // Filtre 1 : même document
    if (ext.corpusId !== refCorpusId) continue

    // Filtre 2 : famille compatible
    const extText = getExtractText(ext)
    const { compatible, borderline } = isFamilyCompatible(ref.family, ext.family, extText)
    if (!compatible) continue

    // Filtre 3 : page (±1 tolérance pour les chunks à cheval)
    if (ref.page !== null && ref.page !== undefined && ext.page !== null && ext.page !== undefined) {
      if (Math.abs(ref.page - ext.page) > 1) continue
    }

    // Filtre 4 : score d'overlap
    const extTokens = normalizeAndTokenize(extText)
    const { overlap, jaccard } = computeScores(refTokens, extTokens)

    // Sélection du meilleur (primaire : overlap, secondaire : jaccard)
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && jaccard > bestJaccard)
    ) {
      bestOverlap = overlap
      bestJaccard = jaccard
      bestCandidate = ext
      bestBorderline = borderline
    }
  }

  // Verdict
  let verdict: MatchVerdict
  if (bestOverlap >= THRESHOLD_MATCH) {
    verdict = bestBorderline ? 'MATCHED_BORDERLINE' : 'MATCHED'
  } else if (bestOverlap >= THRESHOLD_AMBIG_LOW) {
    verdict = 'AMBIGUOUS_MATCH'
  } else {
    verdict = 'MISSED'
  }

  return {
    ref,
    refCorpusId,
    verdict,
    bestCandidate: bestOverlap > 0 ? bestCandidate : undefined,
    overlapScore: bestOverlap,
    jaccardScore: bestJaccard,
  }
}

/**
 * Apparie toutes les références decision d'un corpus donné.
 * Gère les conflits : un extrait ne peut être apparié qu'à une seule référence
 * (celle avec le meilleur score ; les autres repassent au candidat suivant).
 */
export function matchAllDecisions(
  refs: Array<{ element: ReferenceElement; corpusId: string }>,
  extractedList: ExtractedElement[],
): MatchResult[] {
  // Première passe : calculer les scores pour toutes les paires
  const candidates: Array<{
    refIdx: number
    ext: ExtractedElement
    overlap: number
    jaccard: number
    borderline: boolean
  }> = []

  for (let i = 0; i < refs.length; i++) {
    const { element: ref, corpusId: refCorpusId } = refs[i]
    const refTokens = normalizeAndTokenize(ref.excerpt)

    for (const ext of extractedList) {
      if (ext.corpusId !== refCorpusId) continue

      const extText = getExtractText(ext)
      const { compatible, borderline } = isFamilyCompatible(ref.family, ext.family, extText)
      if (!compatible) continue

      if (ref.page !== null && ref.page !== undefined && ext.page !== null && ext.page !== undefined) {
        if (Math.abs(ref.page - ext.page) > 1) continue
      }

      const extTokens = normalizeAndTokenize(extText)
      const { overlap, jaccard } = computeScores(refTokens, extTokens)

      if (overlap >= THRESHOLD_AMBIG_LOW) {
        candidates.push({ refIdx: i, ext, overlap, jaccard, borderline })
      }
    }
  }

  // Tri : meilleur overlap en premier (secondaire : jaccard)
  candidates.sort((a, b) => b.overlap - a.overlap || b.jaccard - a.jaccard)

  // Résolution des conflits : premier arrivé (meilleur score) emporte l'extrait
  const assignedRefs = new Set<number>()
  const assignedExts = new Set<ExtractedElement>()
  const assignments = new Map<number, typeof candidates[0]>()

  for (const c of candidates) {
    if (assignedRefs.has(c.refIdx)) continue
    if (assignedExts.has(c.ext)) continue

    assignedRefs.add(c.refIdx)
    assignedExts.add(c.ext)
    assignments.set(c.refIdx, c)
  }

  // Construction des résultats
  return refs.map(({ element: ref, corpusId: refCorpusId }, i) => {
    const assignment = assignments.get(i)

    if (!assignment) {
      return {
        ref,
        refCorpusId,
        verdict: 'MISSED' as MatchVerdict,
        bestCandidate: undefined,
        overlapScore: 0,
        jaccardScore: 0,
      }
    }

    let verdict: MatchVerdict
    if (assignment.overlap >= THRESHOLD_MATCH) {
      verdict = assignment.borderline ? 'MATCHED_BORDERLINE' : 'MATCHED'
    } else {
      verdict = 'AMBIGUOUS_MATCH'
    }

    return {
      ref,
      refCorpusId,
      verdict,
      bestCandidate: assignment.ext,
      overlapScore: assignment.overlap,
      jaccardScore: assignment.jaccard,
    }
  })
}
