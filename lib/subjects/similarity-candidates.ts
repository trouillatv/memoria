/**
 * Générateur déterministe de paires candidates à la comparaison IA.
 *
 * Objectif : réduire le nombre de paires envoyées à Gemini en filtrant
 * les paires qui n'ont aucune ressemblance lexicale ou contextuelle.
 * Gemini ne doit voir que les paires plausibles.
 */

export interface SubjectForCandidates {
  id: string
  label: string
  aliases: string[]
  topicId: string | null
}

export interface Candidate {
  a: SubjectForCandidates
  b: SubjectForCandidates
  /** Score heuristique 0-100 basé sur la similarité lexicale seule */
  heuristicScore: number
  /** Raison principale du score */
  heuristicReason: string
}

const FRENCH_STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en', 'au', 'aux',
  'sur', 'sous', 'par', 'pour', 'dans', 'avec', 'sans', 'ou', 'à', 'ce',
  'se', 'son', 'sa', 'ses', 'leur', 'leurs', 'il', 'elle', 'ils', 'elles',
  'est', 'sont', 'a', 'ont', 'être', 'avoir', 'que', 'qui', 'ne', 'pas',
  'plus', 'tout', 'mais', 'si', 'comme', 'très', 'bien', 'même',
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !FRENCH_STOPWORDS.has(t)),
  )
}

function allTokens(subject: SubjectForCandidates): Set<string> {
  const all = new Set<string>()
  for (const tok of tokenize(subject.label)) all.add(tok)
  for (const alias of subject.aliases ?? []) {
    for (const tok of tokenize(alias)) all.add(tok)
  }
  return all
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const tok of a) if (b.has(tok)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0
  let hits = 0
  for (const tok of a) if (b.has(tok)) hits++
  return hits / a.size
}

/**
 * Score heuristique entre deux sujets.
 * Retourne null si le score est trop faible pour justifier une analyse Gemini.
 */
export function heuristicScore(
  a: SubjectForCandidates,
  b: SubjectForCandidates,
  crossTopic: boolean,
): Candidate | null {
  const tokA = allTokens(a)
  const tokB = allTokens(b)

  const j = jaccard(tokA, tokB)
  const cAB = containment(tokA, tokB)
  const cBA = containment(tokB, tokA)
  const maxContainment = Math.max(cAB, cBA)

  let score = 0
  let reason = ''

  if (j >= 0.7) { score = 90; reason = 'Jaccard ≥ 0.7 — libellés quasi-identiques' }
  else if (j >= 0.5) { score = 75; reason = 'Jaccard ≥ 0.5 — forte similarité lexicale' }
  else if (maxContainment >= 0.8) { score = 70; reason = 'Containment ≥ 0.8 — un libellé inclus dans l\'autre' }
  else if (j >= 0.35) { score = 55; reason = 'Jaccard ≥ 0.35 — similarité modérée' }
  else if (maxContainment >= 0.6) { score = 45; reason = 'Containment ≥ 0.6 — chevauchement partiel' }
  else if (j >= 0.2) { score = 30; reason = 'Jaccard ≥ 0.2 — similarité faible' }
  else { return null }

  // Pour les paires hors-topic, seuil plus élevé
  const threshold = crossTopic ? 60 : 25
  if (score < threshold) return null

  return { a, b, heuristicScore: score, heuristicReason: reason }
}

/**
 * Génère les paires candidates à analyser par Gemini pour un ensemble de sujets.
 *
 * @param subjects Liste de sujets (tous actifs, déjà filtrés)
 * @param rejectedPairs Paires déjà rejetées humainement à ignorer (normalisées "idA:idB")
 * @param maxPairsPerTopic Limite de paires par topic envoyées à Gemini
 */
export function generateCandidates(
  subjects: SubjectForCandidates[],
  rejectedPairs: Set<string> = new Set(),
  maxPairsPerTopic = 20,
): Candidate[] {
  // Grouper par topic (null = sans thème)
  const byTopic = new Map<string | null, SubjectForCandidates[]>()
  for (const s of subjects) {
    const key = s.topicId ?? null
    const group = byTopic.get(key) ?? []
    group.push(s)
    byTopic.set(key, group)
  }

  const candidates: Candidate[] = []

  for (const [topicId, group] of byTopic) {
    const topicCandidates: Candidate[] = []

    // Paires intra-topic
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        const pairKey = normalizePairKey(a.id, b.id)
        if (rejectedPairs.has(pairKey)) continue

        const candidate = heuristicScore(a, b, false)
        if (candidate) topicCandidates.push(candidate)
      }
    }

    // Trier par score décroissant et limiter
    topicCandidates.sort((x, y) => y.heuristicScore - x.heuristicScore)
    candidates.push(...topicCandidates.slice(0, maxPairsPerTopic))

    // Si le topic a peu de sujets, aussi tester avec les sujets sans thème
    if (topicId !== null && group.length <= 5) {
      const unthemed = byTopic.get(null) ?? []
      for (const a of group) {
        for (const b of unthemed) {
          const pairKey = normalizePairKey(a.id, b.id)
          if (rejectedPairs.has(pairKey)) continue
          const candidate = heuristicScore(a, b, true)
          if (candidate) candidates.push(candidate)
        }
      }
    }
  }

  // Paires intra "sans thème"
  const unthemed = byTopic.get(null) ?? []
  const unthamedCandidates: Candidate[] = []
  for (let i = 0; i < unthemed.length; i++) {
    for (let j = i + 1; j < unthemed.length; j++) {
      const a = unthemed[i]
      const b = unthemed[j]
      const pairKey = normalizePairKey(a.id, b.id)
      if (rejectedPairs.has(pairKey)) continue
      const candidate = heuristicScore(a, b, false)
      if (candidate) unthamedCandidates.push(candidate)
    }
  }
  unthamedCandidates.sort((x, y) => y.heuristicScore - x.heuristicScore)
  candidates.push(...unthamedCandidates.slice(0, maxPairsPerTopic))

  // Dédupliquer par paire normalisée (peut apparaître via plusieurs chemins)
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = normalizePairKey(c.a.id, c.b.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Clé de paire normalisée : toujours idMin:idMax */
export function normalizePairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

/** Retourne [least, greatest] pour l'insertion en base */
export function normalizedPair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA]
}
