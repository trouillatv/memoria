import 'server-only'

// Seuil de similarité Jaccard pour les propositions non-intervenants.
// 0.5 = 50 % de tokens en commun (après normalisation).
// Valeur tunable : abaisser → plus de correspondances (risque faux positifs),
// augmenter → plus strict (risque de rater des fils réels).
const SIMILARITY_THRESHOLD = 0.5

// Stopwords français courants — retirés avant comparaison pour se concentrer
// sur les tokens porteurs de sens (matériau, localisation, désignation technique).
const STOPWORDS = new Set([
  'de','du','la','le','les','des','un','une','et','ou','à','au','aux',
  'en','par','pour','sur','sous','dans','avec','sans','ce','se','sa',
  'son','ses','l','d','est','sont','été','être','avoir','y','il','ils',
])

// Tokens trop génériques pour être discriminants seuls dans un containment match.
// Un label court composé uniquement de ces tokens ne peut pas matcher par containment.
const GENERIC_TOKENS = new Set([
  'plan','essais','travaux','fait','prevision','realisation',
  'acces','raccordement','mise','place','rapport','controle','verification',
  'inspection','suivi','bilan','point','test','visite','reunion','compte',
  'rendu','note','fiche','releve','mesure','calcul','etude','analyse',
])

// Qualificatifs qui changent le sens d'un sujet quand le long les ajoute au court.
// "Purge complémentaire" ≠ "Purge" — "complémentaire" est discriminant.
const QUALIFIERS = new Set([
  'complementaire','supplementaire','additionnel','partiel','temporaire',
])

// P1-C1.2 : vocabulaire de statut nu. Quand stripCategoryFormatting ne laisse plus que
// ces tokens (ex. "Terrassement plateforme - Purge : Fait" → "Fait"), c'est que le
// préfixe ou le suffixe retiré contenait en réalité le sujet — le strip doit être annulé.
// Constitué exclusivement des cas observés dans l'audit read-only P1-C1.2 (23 labels
// TOO_AGGRESSIVE_PREFIX sur données Guillaume) : liste fermée, pas de généralisation.
const STATUS_ONLY_VOCAB = new Set([
  'fait','visa','ok','attente','cours','prevoir','validation','effectuee','non','conforme',
])

/**
 * Normalise un label pour la comparaison :
 * minuscules → suppression accents → alphanumériques uniquement → filtrage stopwords
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // supprimer les diacritiques
    .replace(/[^a-z0-9\s]/g, ' ')      // garder alphanumérique + espaces
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .join(' ')
    .trim()
}

/**
 * Retire le préfixe catégorie ("Catégorie : texte" → "texte")
 * et le suffixe statut ("texte = Statut" → "texte") avant le matching par containment.
 * Les PV07+ utilisent ce format enrichi ; PV06 n'a que le sujet nu.
 *
 * Garde P1-C1.2 : si le résultat des deux strips ne contient plus que du vocabulaire
 * de statut générique (STATUS_ONLY_VOCAB), le sujet réel était en fait dans la partie
 * retirée — annuler le strip et conserver le label complet plutôt que de comparer deux
 * labels différents réduits au même mot-état (ex. "Plan des installations de chantier : FAIT"
 * ne doit pas devenir indiscernable de "Plan de gestion des eaux pluviales : FAIT").
 */
export function stripCategoryFormatting(label: string): string {
  let s = label
  // Retirer le préfixe "Catégorie : " (premier " : " seulement)
  const colonIdx = s.indexOf(' : ')
  if (colonIdx !== -1) s = s.slice(colonIdx + 3)
  // Retirer le suffixe " = Statut" (dernière occurrence de " = ")
  const eqIdx = s.lastIndexOf(' = ')
  if (eqIdx !== -1) s = s.slice(0, eqIdx)
  const core = s.trim()

  if (colonIdx === -1 && eqIdx === -1) return core

  const coreTokens = normalizeLabel(core).split(' ').filter(Boolean)
  const isStatusOnly = coreTokens.length > 0 && coreTokens.every((t) => STATUS_ONLY_VOCAB.has(t))
  if (isStatusOnly) return label.trim()

  return core
}

/**
 * Matching par containment fort : vérifie que les tokens du label court sont tous
 * présents dans les tokens du label long, avec assez de tokens discriminants.
 *
 * Étape 0 : correspondance exacte après stripCategoryFormatting (ex. "Purge" = stripped de
 *   "Terrassement plateforme : Purge = Fait") → retourne true immédiatement.
 *
 * Étape 1 : containment sur labels RAW normalisés (sans stripping), pour capter les cas
 *   où le sujet est le préfixe du PV07 (ex. "Débroussaillage" ⊂ "Débroussaillage : 100% réalisé").
 *
 * Gardes :
 * - Si le long ajoute un qualificatif discriminant (QUALIFIERS) absent du court : rejeter
 *   ("Purge" ⊄ "Purge complémentaire"), quel que soit le nombre de tokens significatifs du
 *   court — y compris quand les deux labels partagent un préfixe commun de plusieurs tokens
 *   (ex. "Terrassement plateforme : Purge" ⊄ "Terrassement plateforme : Purge complémentaire").
 * - Sinon : ≥ 2 tokens significatifs (hors GENERIC_TOKENS) dans le court
 * - OU 1 token significatif de longueur ≥ 7 (terme métier spécifique)
 */
export function strongContainmentMatch(labelA: string, labelB: string): boolean {
  // Étape 0 : exact après stripping des deux côtés
  const strippedA = normalizeLabel(stripCategoryFormatting(labelA))
  const strippedB = normalizeLabel(stripCategoryFormatting(labelB))
  if (strippedA.length > 0 && strippedA === strippedB) return true

  // Étape 1 : containment sur labels RAW normalisés
  const normA = normalizeLabel(labelA)
  const normB = normalizeLabel(labelB)

  const tokA = normA.split(' ').filter(Boolean)
  const tokB = normB.split(' ').filter(Boolean)

  if (tokA.length === 0 || tokB.length === 0) return false

  const setA = new Set(tokA)
  const setB = new Set(tokB)
  // Le label avec moins de tokens uniques est le "court"
  const [shortToks, shortSet, longSet] = setA.size <= setB.size
    ? [tokA, setA, setB]
    : [tokB, setB, setA]

  // Tous les tokens du court doivent être dans le long
  for (const t of shortSet) {
    if (!longSet.has(t)) return false
  }

  // Garde : rejeter si le long ajoute un qualificatif discriminant que le court n'a pas,
  // avant toute décision basée sur le nombre de tokens significatifs (voir docstring).
  const longOnlyToks = [...longSet].filter((t) => !shortSet.has(t))
  if (longOnlyToks.some((t) => QUALIFIERS.has(t))) return false

  // Tokens significatifs du court (hors génériques)
  const sigShort = shortToks.filter((t) => !GENERIC_TOKENS.has(t))

  if (sigShort.length >= 2) return true

  if (sigShort.length === 1) {
    // Token unique : accepté seulement s'il est assez spécifique (≥ 7 chars)
    if (sigShort[0].length < 7) return false
    return true
  }

  return false
}

/**
 * Similarité de Jaccard sur ensembles de tokens.
 * Deux labels parfaitement identiques → 1.0. Sans tokens communs → 0.
 * Exportée pour les tests unitaires.
 */
export function jaccardSimilarity(labelA: string, labelB: string): number {
  const tokA = new Set(normalizeLabel(labelA).split(' ').filter(Boolean))
  const tokB = new Set(normalizeLabel(labelB).split(' ').filter(Boolean))
  if (tokA.size === 0 && tokB.size === 0) return 1
  if (tokA.size === 0 || tokB.size === 0) return 0
  let intersection = 0
  for (const t of tokA) { if (tokB.has(t)) intersection++ }
  const union = tokA.size + tokB.size - intersection
  return intersection / union
}

export type ProposalStub = {
  id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  subject_thread_id: string | null
}

/** Proposition qui n'a trouvé aucun thread antérieur et a reçu un nouveau UUID. */
export type OrphanInfo = {
  propId: string
  threadId: string
  label: string
  family: string
}

type ScoredCandidate = {
  propId: string
  thread: string
  /** 1.0 = exact, 0.85 = containment, 0.5–0.84 = Jaccard */
  score: number
}

function isPersonLike(family: string): boolean {
  return family === 'person' || family === 'company'
}

/**
 * Calcule le meilleur match scoré pour une proposition dans un ensemble de précédentes.
 * Score : 1.0 = exact après strip, 0.85 = containment, sinon score Jaccard.
 */
function computeBestCandidate(newProp: ProposalStub, priors: ProposalStub[]): ScoredCandidate | null {
  const sameFamilyPriors = priors.filter(
    (p) => p.proposal_family === newProp.proposal_family && p.subject_thread_id !== null,
  )

  if (isPersonLike(newProp.proposal_family)) {
    const newNorm = normalizeLabel(newProp.label)
    const match = sameFamilyPriors.find((p) => normalizeLabel(p.label) === newNorm)
    return match ? { propId: newProp.id, thread: match.subject_thread_id!, score: 1.0 } : null
  }

  // P1-C1 : thematic_category n'est plus une condition bloquante d'identité.
  // proposal_family reste la frontière forte (sameFamilyPriors ci-dessus, inchangé).
  // Le thème redevient un signal secondaire : à score égal (égalité stricte de longueur
  // ou de score Jaccard), on préfère le candidat de même thème, sans jamais bonifier
  // artificiellement un score (qui pourrait faire franchir SIMILARITY_THRESHOLD à tort).
  const sameTheme = (p: ProposalStub) => p.thematic_category === newProp.thematic_category

  // Exact après stripping
  const newNormStripped = normalizeLabel(stripCategoryFormatting(newProp.label))
  const exactMatches = sameFamilyPriors.filter(
    (p) => normalizeLabel(stripCategoryFormatting(p.label)) === newNormStripped,
  )
  if (exactMatches.length > 0) {
    const exactMatch = exactMatches.find(sameTheme) ?? exactMatches[0]
    return { propId: newProp.id, thread: exactMatch.subject_thread_id!, score: 1.0 }
  }

  // Containment fort
  let bestContainment: ProposalStub | null = null
  let bestContainmentLen = 0
  for (const prior of sameFamilyPriors) {
    if (strongContainmentMatch(newProp.label, prior.label)) {
      const priorLen = normalizeLabel(stripCategoryFormatting(prior.label)).length
      if (
        priorLen > bestContainmentLen ||
        (priorLen === bestContainmentLen && sameTheme(prior) && bestContainment && !sameTheme(bestContainment))
      ) {
        bestContainment = prior
        bestContainmentLen = priorLen
      }
    }
  }
  if (bestContainment) return { propId: newProp.id, thread: bestContainment.subject_thread_id!, score: 0.85 }

  // Jaccard sur labels strippés
  let bestJaccard = 0
  let bestThread: string | null = null
  let bestIsSameTheme = false
  const newStripped = stripCategoryFormatting(newProp.label)
  const newStrippedTokens = new Set(normalizeLabel(newStripped).split(' ').filter(Boolean))
  for (const prior of sameFamilyPriors) {
    const priorStripped = stripCategoryFormatting(prior.label)
    // Garde : un qualificatif discriminant (QUALIFIERS) présent d'un seul côté écarte
    // le candidat, même si le score Jaccard atteint le seuil (même règle que containment,
    // sinon "Purge" ⊂ "Purge complémentaire" repasse par ce chemin après strip).
    const priorStrippedTokens = new Set(normalizeLabel(priorStripped).split(' ').filter(Boolean))
    const hasQualifierAsymmetry = [...QUALIFIERS].some(
      (q) => newStrippedTokens.has(q) !== priorStrippedTokens.has(q),
    )
    if (hasQualifierAsymmetry) continue
    const score = jaccardSimilarity(newStripped, priorStripped)
    if (score > bestJaccard || (score === bestJaccard && score > 0 && sameTheme(prior) && !bestIsSameTheme)) {
      bestJaccard = score
      bestThread = prior.subject_thread_id
      bestIsSameTheme = sameTheme(prior)
    }
  }
  if (bestJaccard >= SIMILARITY_THRESHOLD && bestThread) {
    return { propId: newProp.id, thread: bestThread, score: bestJaccard }
  }
  return null
}

/**
 * Résout les matches 1:1 entre nouvelles propositions et threads précédents.
 * Retourne un map propId → subject_thread_id à écrire en DB.
 *
 * Algorithme glouton par score décroissant :
 * - On calcule le meilleur candidat pour chaque nouvelle proposition.
 * - On trie par score décroissant (exact > containment > Jaccard).
 * - On assigne en priorité les meilleurs couples.
 * - Un thread précédent déjà consommé ne peut être attribué à une autre proposition.
 * - Une proposition sans match ou en conflit reçoit un nouveau UUID.
 *
 * Exporté pour les tests unitaires. Le `generateUUID` est injectable pour rendre
 * les tests déterministes.
 */
export function resolveMatches1to1(
  newProposals: ProposalStub[],
  priorProposals: ProposalStub[],
  generateUUID: () => string = () => crypto.randomUUID(),
): Map<string, string> {
  const candidates: ScoredCandidate[] = []
  for (const p of newProposals) {
    const cand = computeBestCandidate(p, priorProposals)
    if (cand) candidates.push(cand)
  }

  candidates.sort((a, b) => b.score - a.score)

  const claimedThreads = new Set<string>()
  const assignedProps = new Set<string>()
  const result = new Map<string, string>()

  for (const cand of candidates) {
    if (!assignedProps.has(cand.propId) && !claimedThreads.has(cand.thread)) {
      assignedProps.add(cand.propId)
      claimedThreads.add(cand.thread)
      result.set(cand.propId, cand.thread)
    }
  }

  for (const p of newProposals) {
    if (!result.has(p.id)) {
      result.set(p.id, generateUUID())
    }
  }

  return result
}

/**
 * Assigne un subject_thread_id à toutes les propositions d'un run qui n'en ont pas encore.
 *
 * - Si une proposition antérieure sur le même chantier correspond → même thread.
 * - Sinon → nouveau UUID (premier PV à mentionner ce sujet).
 *
 * Appelé après la fin de l'extraction (run → ready_for_review).
 * Idempotent : les propositions déjà assignées sont ignorées.
 *
 * Retourne { matched, created, orphans } pour logging et résolution sémantique.
 */
export async function reconcileSubjectThreads(
  runId: string,
  siteId: string,
): Promise<{ matched: number; created: number; orphans: OrphanInfo[] }> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  // Charger les nouvelles propositions sans thread (idempotent : skip les assignées)
  const { data: newRaw, error: newErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, proposal_family, thematic_category, label, subject_thread_id')
    .eq('extraction_run_id', runId)
    .is('subject_thread_id', null)
  if (newErr) throw new Error(newErr.message)
  if (!newRaw?.length) return { matched: 0, created: 0, orphans: [] }
  const newProposals = newRaw as ProposalStub[]

  // Charger les propositions antérieures issues uniquement des runs canoniques.
  // Les re-analyses non-canoniques sont exclues pour éviter la pollution du graphe thématique.
  const { data: canonicalRunsData } = await supabase
    .from('document_extraction_run')
    .select('id')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
    .neq('id', runId)
  const canonicalRunIds = ((canonicalRunsData ?? []) as Array<{ id: string }>).map((r) => r.id)

  let priorProposals: ProposalStub[] = []
  if (canonicalRunIds.length > 0) {
    const { data: priorRaw, error: priorErr } = await supabase
      .from('document_extraction_proposal')
      .select('id, proposal_family, thematic_category, label, subject_thread_id')
      .in('extraction_run_id', canonicalRunIds)
      .not('subject_thread_id', 'is', null)
    if (priorErr) throw new Error(priorErr.message)
    priorProposals = (priorRaw ?? []) as ProposalStub[]
  }

  const threadMap = resolveMatches1to1(newProposals, priorProposals)

  let matched = 0
  let created = 0
  const orphans: OrphanInfo[] = []
  const assignments = newProposals.map((p) => {
    const subject_thread_id = threadMap.get(p.id)!
    const isNew = !priorProposals.some((pr) => pr.subject_thread_id === subject_thread_id)
    if (isNew) {
      created++
      orphans.push({ propId: p.id, threadId: subject_thread_id, label: p.label, family: p.proposal_family })
    } else {
      matched++
    }
    return { id: p.id, subject_thread_id }
  })

  // Mise à jour individuelle — les runs ont ~50–150 propositions max
  const errors: string[] = []
  await Promise.all(
    assignments.map(async ({ id, subject_thread_id }) => {
      const { error } = await supabase
        .from('document_extraction_proposal')
        .update({ subject_thread_id })
        .eq('id', id)
      if (error) errors.push(error.message)
    }),
  )
  if (errors.length > 0) throw new Error(`subject_thread assignment: ${errors.join('; ')}`)

  return { matched, created, orphans }
}

/**
 * Mappe le texte libre statusAtDocumentDate → enum document_status normalisé.
 * Ne s'applique pas aux intervenants (person / company) dont le statut est la présence.
 *
 * Ordre du plus spécifique au plus général pour éviter les collisions :
 * ex. "non démarré" doit → planned avant que "démarr" → in_progress soit testé ;
 *     "VISA en cours" doit → awaiting_validation avant que "en cours" → in_progress ;
 *     "partiellement réalisé" doit → in_progress avant que "réalis" → done.
 */
export function mapDocumentStatus(
  statusAtDocumentDate: string | null | undefined,
  family: string,
): string | null {
  if (family === 'person' || family === 'company') return null
  if (!statusAtDocumentDate) return null
  const s = statusAtDocumentDate.toLowerCase()
  if (/non conform|refus|hors tolérance/.test(s)) return 'non_compliant'
  if (/non démarr|non commenc|prévu|planif|programm/.test(s)) return 'planned'
  if (/en attente|attendu|visa|validation/.test(s)) return 'awaiting_validation'
  if (/annul|abandonn/.test(s)) return 'cancelled'
  if (/en cours|partiell|démarr/.test(s)) return 'in_progress'
  // Garde-fou P1-3C.2 : "à faire/réaliser/transmettre" = tâche non soldée → open,
  // AVANT la règle done ("réalis"/"exécut" matcheraient sinon à tort).
  if (/à faire|à réaliser|à transmettre/.test(s)) return 'open'
  if (/réalis|termin|levé|exécut|accompl/.test(s) || s === 'fait') return 'done'
  if (/ouvert|signalé|constaté/.test(s)) return 'open'
  return 'informational'
}
