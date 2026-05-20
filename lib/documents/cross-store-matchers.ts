// B2 — helpers PURS pour le pont cross-store documents ↔ traces site
// (approche β). Pas de `server-only`, pas d'I/O, pas d'IA, pas
// d'embeddings. Testables hors runtime serveur. Le module server-only
// `./cross-store-resonances.ts` (T2) les réutilise.
//
// Doctrine B2 — ratification Vincent 2026-05-20 (Q1 renforcée) :
//
//   « Un lien utile doit aider un humain terrain à agir.
//     Pas juste 'c'est intéressant'. »
//
// Deux filtres en AND avant d'émettre une résonance (cosine ≥ seuil
// est nécessaire mais JAMAIS suffisant) :
//   1. chunkSignalsAction(chunkText) — le chunk doc cite une
//      action/procédure/obligation actionnable.
//   2. traceSignalsActionable(kind, text) — la trace signale une
//      situation qui appelle une action (kind ou keyword d'issue).
//
// Si un seul des deux échoue → pas de résonance. Précision >> rappel.

import { frDayMonth } from './resonance-matchers'

export { frDayMonth }

// ============================================================================
// Constantes B2 (paramètres internes, jamais doctrine)
// ============================================================================

/** Seuil cosine — haut volontairement (β strict, ratifié Vincent). Si
 *  peu de matches après observation, baisser à 0.75 en bumpant
 *  l'algorithm_version → b2_doc_trace_v2 (jamais figé en doctrine). */
export const B2_COSINE_THRESHOLD = 0.80

/** Top-K traces par (chunk, site) — 1 seul match, le meilleur. */
export const B2_TOP_K_PER_CHUNK = 1

/** Plafond résonances B2 actives par site (séparé du B1 ≤3 ; total ≤5). */
export const B2_MAX_PER_SITE = 2

/** Durée de vie d'une résonance B2 (re-validation à 30 j, cohérent B1). */
export const B2_EXPIRE_DAYS = 30

/** Algorithme namespacé. Bump _v2 si seuil/règle/wording change.
 *  v2 (Vincent 2026-05-20) : ajout micro-snippet déterministe extrait du
 *  chunk doc (4-7 mots autour du mot d'action) + dedup per-trace. */
export const B2_ALGO = 'b2_doc_trace_v2'

/** Types de documents acceptés (juridiques EXCLUS d'office, cohérent B1
 *  et mémoire `litige-no-automatic-reading`). */
export const B2_DOC_TYPES_ALLOWED = [
  'plan_acces',
  'securite',
  'procedure',
  'protocole',
] as const

/** Visibilités acceptées en source — défense en profondeur identique B1.
 *  admin_only/manager NE produisent JAMAIS de résonance site (verrou
 *  invariant sécurité §3 du protocole d'observation). */
export const B2_VISIBILITY_ALLOWED = ['operations', 'field'] as const

// ============================================================================
// Filtre 1 — le chunk doc cite-t-il une action actionnable ?
// ============================================================================

/** Verbes d'action terrain (infinitif, déjà normalisés sans diacritiques). */
const ACTION_VERBS = [
  'fermer', 'ouvrir', 'verifier', 'controler', 'nettoyer', 'remplir',
  'signaler', 'badger', 'utiliser', 'porter', 'installer', 'changer',
  'evacuer', 'desinfecter', 'laver', 'rincer', 'aspirer', 'balayer',
  'tracer', 'documenter', 'isoler', 'eteindre', 'allumer', 'verrouiller',
  'deverrouiller', 'remplacer', 'reparer', 'maintenir', 'intervenir',
  'eviter', 'respecter', 'appliquer', 'noter', 'cocher', 'prevenir',
]

/** Substantifs d'action / procédure (jamais des domaines larges comme
 *  « sécurité » qui matcheraient tout chunk d'un doc securite). */
const ACTION_NOUNS = [
  'procedure', 'protocole', 'intervention', 'nettoyage', 'controle',
  'verification', 'lavage', 'desinfection', 'evacuation', 'rincage',
  'aspiration', 'balayage', 'isolement', 'maintenance', 'reparation',
  'remplacement', 'signalement', 'badge', 'consigne',
]

/** Marqueurs d'obligation/sécurité. */
const OBLIGATION_MARKERS = [
  'obligatoire', 'imperative', 'imperatif', 'interdit', 'interdite',
  'autorise', 'autorisee', 'requis', 'requise', 'necessaire',
  'recommande', 'recommandee', 'defendu', 'defendue', 'prohibe',
]

const ACTION_LEXICON: ReadonlySet<string> = new Set([
  ...ACTION_VERBS,
  ...ACTION_NOUNS,
  ...OBLIGATION_MARKERS,
])

/** Taille du lexique d'action — exposé pour test de régression. */
export const B2_ACTION_LEXICON_SIZE = ACTION_LEXICON.size

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Détecte un signal d'action dans un chunk doc.
 *  Approche : tokens ≥3 chars normalisés, intersection avec le lexique
 *  d'action. ≥1 token suffit — le filtre cosine + traceSignalsActionable
 *  reste en AND par-dessus. */
export function chunkSignalsAction(chunkText: string): boolean {
  if (!chunkText) return false
  const tokens = normalize(chunkText)
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3)
  for (const t of tokens) {
    if (ACTION_LEXICON.has(t)) return true
  }
  return false
}

// ============================================================================
// Filtre 2 — la trace signale-t-elle une situation actionnable ?
// ============================================================================

/** Types de traces actionnables par construction (kind seul suffit) :
 *  - anomaly : par définition à corriger.
 *  - access_incident : à investiguer.
 *  - site_note_a_savoir : consigne explicite à transmettre. */
export const B2_TRACE_KINDS_ACTIONABLE = [
  'anomaly',
  'access_incident',
  'site_note_a_savoir',
] as const

/** Keywords d'issue (déjà normalisés sans diacritiques). Une trace
 *  neutre (intervention OK, note descriptive sans problème) ne matche
 *  pas. */
const ISSUE_KEYWORDS_NORMALIZED: readonly string[] = [
  'casse', 'manquant', 'manque', 'absent', 'absente', 'bloque',
  'bloquee', 'fuite', 'glissant', 'glissante', 'dangereux',
  'dangereuse', 'panne', 'defectueux', 'defectueuse', 'inoperant',
  'inoperante', 'probleme', 'incident', 'urgence', 'fumee',
  'odeur', 'aboye', 'aboiement', 'morsure', 'chute', 'blessure',
  'fissure', 'cassure', 'rupture', 'humide', 'mouille', 'mouillee',
  'eteint', 'eteinte',
]

/** Taille des keywords d'issue — exposé pour test de régression. */
export const B2_ISSUE_KEYWORDS_SIZE = ISSUE_KEYWORDS_NORMALIZED.length

/** Vérifie si une trace signale une situation appelant une action.
 *  - `kind` ∈ B2_TRACE_KINDS_ACTIONABLE → true direct.
 *  - sinon, fallback keyword sur `text` normalisé. */
export function traceSignalsActionable(kind: string, text: string | null): boolean {
  if ((B2_TRACE_KINDS_ACTIONABLE as readonly string[]).includes(kind)) return true
  if (!text) return false
  const norm = normalize(text)
  for (const kw of ISSUE_KEYWORDS_NORMALIZED) {
    if (norm.includes(kw)) return true
  }
  return false
}

// ============================================================================
// Template fragment B2 — épistémologie de la plausibilité
// ============================================================================
// « semble en écho » — continuité plausible, jamais vérité (cf.
// memory `echo-juste-not-truth`). Le fragment cite UNIQUEMENT les IDs
// (cliquables côté UI) + labels stables + date. AUCUNE extraction de
// contenu doc/trace (anti-fuite, anti-recopie de contexte sensible).

/** Intro doctype avec accord grammatical (genre/participe). */
function doctypeIntro(t: string): string {
  switch (t) {
    case 'plan_acces': return "Le plan d'accès rattaché"
    case 'securite': return 'La consigne de sécurité rattachée'
    case 'procedure': return 'La procédure rattachée'
    case 'protocole': return 'Le protocole rattaché'
    default: return 'Le document rattaché'
  }
}

/** Label trace humain. */
function traceLabel(kind: string): string {
  switch (kind) {
    case 'anomaly': return "l'anomalie signalée"
    case 'access_incident': return "l'incident d'accès"
    case 'site_note_a_savoir': return 'le savoir terrain'
    case 'site_note': return 'la note terrain'
    case 'intervention': return "la trace d'intervention"
    default: return "l'observation terrain"
  }
}

/** Assemble le fragment B2 — v1 (sans snippet). Conservé pour
 *  rétrocompat ; v2 utilise buildB2FragmentV2 avec snippet. */
export function buildB2Fragment(params: {
  docId: string
  docType: string
  traceId: string
  traceKind: string
  traceDateIso: string
}): string {
  const intro = doctypeIntro(params.docType)
  const tl = traceLabel(params.traceKind)
  const date = frDayMonth(params.traceDateIso)
  return `${intro} à ce site [doc:${params.docId}] semble en écho avec ${tl} du ${date} [trace:${params.traceId}].`
}

// ============================================================================
// V2 (Vincent 2026-05-20) — micro-snippet déterministe + wording aligné B1
// ============================================================================

/** Extrait un micro-snippet déterministe (4-7 mots) du chunk doc, centré
 *  sur le PREMIER mot du lexique action trouvé.
 *
 *  Garde-fous stricts (Vincent 2026-05-20) :
 *  - 4 à 7 mots maximum (jamais une phrase longue)
 *  - jamais de saut de ligne (\s+ collapsé en espace simple)
 *  - ponctuation aux bords retirée
 *  - guillemets retirés (on les re-pose dans le template)
 *  - longueur dure plafonnée 80 chars (sinon null = pas d'émission)
 *  - retourne null si aucun mot d'action trouvé (sécurité)
 *
 *  PUR. Ne touche jamais au texte de la trace (zéro recopie terrain). */
export function extractActionSnippet(
  chunkText: string,
  maxWords: number = 7,
): string | null {
  if (!chunkText || typeof chunkText !== 'string') return null

  // Tokenize en gardant la version brute (case + accents préservés
  // pour lisibilité humaine — « PC sécurité » plutôt que « pc securite »).
  const tokenRe = /\S+/g
  const tokens: string[] = []
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(chunkText)) !== null) {
    tokens.push(m[0])
  }
  if (tokens.length === 0) return null

  // Trouve le premier mot dont la forme normalisée OU l'une de ses
  // sous-formes (séparées par apostrophe/ponctuation interne) est dans
  // ACTION_LEXICON. Aligné sur la sémantique de chunkSignalsAction qui
  // splitte sur non-lettre — sinon « s'ouvrir » échoue ici alors qu'il
  // passe le filtre amont (et on retourne null injustement).
  const actionIdx = tokens.findIndex((tok) => {
    const normalized = normalize(tok)
    // Sous-mots = séquences contiguës de lettres a-z (apostrophe, chiffres,
    // ponctuation = séparateurs). « l'utilisation » → ["l", "utilisation"]
    // → on cherche « utiliser » (verbe lexique) — non trouvé, mais
    // « s'ouvrir » → ["s", "ouvrir"] → « ouvrir » ✓ trouvé.
    const subwords = normalized.split(/[^a-z]+/).filter((w) => w.length >= 3)
    return subwords.some((w) => ACTION_LEXICON.has(w))
  })
  if (actionIdx === -1) return null

  // Fenêtre : ≤ 3 mots avant + le mot action + ≤ (maxWords-1) mots après,
  // capped à maxWords total. Préfère le contexte qui suit (souvent plus
  // informatif : « nettoyage des sols quotidiennement » vs « des sols
  // quotidiennement nettoyage »).
  const wordsBefore = Math.min(2, actionIdx)
  const from = actionIdx - wordsBefore
  const to = Math.min(tokens.length, from + maxWords)
  const slice = tokens.slice(from, to)

  let snippet = slice.join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Trim ponctuation aux bords + retire guillemets internes.
  snippet = snippet
    .replace(/^[,;:.!?…\-—«»"'(\[]+/, '')
    .replace(/[,;:.!?…\-—«»"')\]]+$/, '')
    .replace(/[«»"']/g, '')
    .trim()

  if (snippet.length === 0) return null
  if (snippet.length > 80) return null // anti dérive : trop long = on émet rien

  return snippet
}

/** Assemble le fragment B2 v2 — wording aligné B1 (« mentionne « X » »)
 *  avec terminaison prudente « en écho » (sémantique, pas vérité).
 *
 *  Template fixe :
 *    «La procédure rattachée [doc:XXX] mentionne « <snippet> » —
 *     note terrain du <date> en écho [trace:YYY].»
 *
 *  Garde-fous Vincent 2026-05-20 :
 *  - jamais de "prouve / confirme / démontre / certifie"
 *  - "en écho" conservé (continuité plausible, pas vérité)
 *  - snippet 4-7 mots, vient du DOC uniquement (jamais de la trace)
 *  - [doc:id] + [trace:id] obligatoires (2 sources) */
export function buildB2FragmentV2(params: {
  docId: string
  docType: string
  traceId: string
  traceDateIso: string
  snippet: string
}): string {
  const intro = doctypeIntro(params.docType)
  const date = frDayMonth(params.traceDateIso)
  return `${intro} [doc:${params.docId}] mentionne « ${params.snippet} » — note terrain du ${date} en écho [trace:${params.traceId}].`
}
