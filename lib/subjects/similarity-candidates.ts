/**
 * Générateur déterministe de paires candidates à la comparaison IA.
 *
 * Doctrine :
 * - Le LLM classifie la relation, il n'est pas l'autorité de fusion.
 * - La détection de type bloque les paires incompatibles AVANT Gemini.
 * - Une paire bloquée peut toujours être envoyée comme candidat "link only",
 *   jamais comme candidat de fusion.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SubjectForCandidates {
  id: string
  label: string
  aliases: string[]
  topicId: string | null
}

/**
 * Type structurel détecté sur le libellé d'un sujet.
 *
 * - person_name  : initiale + nom (M. DUPONT, Mme ROUSSEL, G. DEVALLEZ)
 * - dated_event  : contient une date explicite (30/03, du 16/02 au 06/03)
 * - document     : Rapport, Avis G3, CR, Plan, Fiche technique, VISA
 * - prevision    : commence par "Prévision :"
 * - business     : sujet métier standard, aucun marqueur particulier
 */
export type SubjectTypeHint = 'person_name' | 'dated_event' | 'document' | 'prevision' | 'business'

export interface Candidate {
  a: SubjectForCandidates
  b: SubjectForCandidates
  typeHintA: SubjectTypeHint
  typeHintB: SubjectTypeHint
  /** Score heuristique 0-100 basé sur la similarité lexicale seule */
  heuristicScore: number
  /** Raison principale du score heuristique */
  heuristicReason: string
  /**
   * Si non null : la fusion est bloquée pour cette paire.
   * Gemini peut toujours être appelé pour déterminer un lien, mais
   * la recommendation "merge" doit être ignorée par le batch.
   */
  fusionBlockReason: string | null
}

// ── Détection de type ──────────────────────────────────────────────────────────

/** Regex de date explicite : 30/03, 20.02, "du 16/02 au 06/03", "17,5 jours" */
const DATE_PATTERN = /\b\d{1,2}[./]\d{2}|\bdu\s+\d{1,2}\/\d{2}|\bjours?\b/i

/** Termes documentaires : rapport, avis, CR, plan, fiche, visa, note, livret */
const DOC_PATTERN = /\b(avis\b|rapport\b|cr\b|visa\b|plan\b|fiche\b|ft\b|note\b|livret\b|attestation\b|procès[-\s]verbal\b|pv\b)/i

/** Initiale + nom en majuscule (M. DUPONT, Mme ROUSSEL, G. DEVALLEZ) */
const PERSON_PATTERN = /^(M\.?|Mme\.?|Mr\.?|Dr\.?|G\.?|J\.?|P\.?|L\.?|R\.?|A\.?|B\.?|C\.?|D\.?|E\.?|F\.?|H\.?|I\.?|K\.?|N\.?|O\.?|Q\.?|S\.?|T\.?|U\.?|V\.?|W\.?|X\.?|Y\.?|Z\.?)\s+[A-ZÉÈÀÙÂÊÎÔÛÄËÏÖÜ]{2}/

export function detectTypeHint(label: string): SubjectTypeHint {
  const trimmed = label.trim()
  if (PERSON_PATTERN.test(trimmed)) return 'person_name'
  if (/^[Pp]révision\s*:/i.test(trimmed)) return 'prevision'
  if (DATE_PATTERN.test(trimmed)) return 'dated_event'
  if (DOC_PATTERN.test(trimmed)) return 'document'
  return 'business'
}

/**
 * Vérifie si la fusion est incompatible entre deux types.
 * Retourne la raison de blocage, ou null si la fusion est permise.
 */
export function fusionBlockReason(typeA: SubjectTypeHint, typeB: SubjectTypeHint): string | null {
  // Personnes : jamais via ce moteur, même entre elles
  if (typeA === 'person_name' || typeB === 'person_name') {
    return 'Pattern acteur détecté — résolution d\'identité distincte requise'
  }
  // Événement daté ↔ document résultant : relation, pas fusion
  if (typeA === 'dated_event' && typeB === 'document') {
    return 'Événement daté ↔ document résultant — lien uniquement (validates/causes)'
  }
  if (typeA === 'document' && typeB === 'dated_event') {
    return 'Document résultant ↔ événement daté — lien uniquement (validates/causes)'
  }
  // Deux événements datés distincts ne fusionnent pas (chacun garde sa temporalité)
  if (typeA === 'dated_event' && typeB === 'dated_event') {
    return 'Deux événements datés — vérifier que les dates se chevauchent avant de fusionner'
  }
  // Prévision ↔ réalisé : à envoyer à Gemini avec flag, mais bloquer la fusion auto
  if (typeA === 'prevision' || typeB === 'prevision') {
    return 'Prévision détectée — fusion conditionnelle, revue humaine requise'
  }
  return null
}

// ── Similarité lexicale ────────────────────────────────────────────────────────

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

// ── Scoring heuristique ────────────────────────────────────────────────────────

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

  const threshold = crossTopic ? 60 : 25
  if (score < threshold) return null

  const typeHintA = detectTypeHint(a.label)
  const typeHintB = detectTypeHint(b.label)
  const blockReason = fusionBlockReason(typeHintA, typeHintB)

  // Les personnes sont totalement exclues (même en tant que candidats de lien)
  if (typeHintA === 'person_name' || typeHintB === 'person_name') return null

  return {
    a, b,
    typeHintA,
    typeHintB,
    heuristicScore: score,
    heuristicReason: reason,
    fusionBlockReason: blockReason,
  }
}

// ── Génération de candidats ────────────────────────────────────────────────────

/**
 * Génère les paires candidates à analyser par Gemini pour un ensemble de sujets.
 *
 * @param subjects Liste de sujets (tous actifs, déjà filtrés)
 * @param rejectedPairs Paires déjà rejetées humainement à ignorer
 * @param maxPairsPerTopic Budget de paires par topic (V1 configurable, défaut 20)
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

    topicCandidates.sort((x, y) => y.heuristicScore - x.heuristicScore)
    candidates.push(...topicCandidates.slice(0, maxPairsPerTopic))

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

  // Dédupliquer
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const key = normalizePairKey(c.a.id, c.b.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Utilitaires ────────────────────────────────────────────────────────────────

/** Clé de paire normalisée : toujours idMin:idMax */
export function normalizePairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

/** Retourne [least, greatest] pour l'insertion en base */
export function normalizedPair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA]
}
