// Couche orale des réponses du Copilote — module pur, sans DOM, sans réseau.
//
// Doctrine : le texte porte la profondeur, la voix porte l'essentiel. La voix
// n'est ni une source de vérité supplémentaire, ni un risque pour la réponse
// métier. D'où l'invariant qui gouverne tout ce fichier :
//
//   AUCUNE fonction d'ici ne peut faire échouer une réponse.
//   Tout ce qui est douteux est jeté en silence et renvoie `null`.
//
// C'est pour cette raison que `spokenText` ne fait PAS partie du schéma Zod qui
// valide la réponse du LLM. Un `spokenText` de 420 caractères dans un schéma
// bloquant ferait échouer le parse global, basculerait en repli déterministe et
// dégraderait le texte — exactement la régression qu'on cherche à éviter. Le
// champ est donc lu à côté, sur l'objet brut, et validé ici.

/** Au-delà, on jette : une synthèse orale plus longue n'en est plus une. */
export const SPOKEN_MAX_CHARS = 400

/**
 * Seuil sous lequel une réponse SANS `spokenText` (repli déterministe, verdict
 * quantitatif) est directement lisible telle quelle. Au-dessus, silence : on ne
 * lit pas une check-list à voix haute, et on ne paie pas un second appel LLM
 * pour la résumer.
 */
export const SHORT_ANSWER_MAX_CHARS = 180

/** Retire le balisage Markdown — la voix ne prononce pas des astérisques. */
function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '')
    .replace(/^[ \t]{0,3}\d+[.)][ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

function normalizeForSpeech(input: string): string {
  return stripMarkdown(input)
    .replace(UUID_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Valide le `spokenText` renvoyé par le LLM. Volontairement séparé de la
 * validation de la réponse : mauvais type, vide ou trop long → `null`, jamais
 * une erreur, jamais un repli métier.
 *
 * Trop long = jeté, pas tronqué : couper à 400 caractères produirait une phrase
 * amputée en plein milieu, ce qui s'entend beaucoup plus qu'un silence.
 */
export function sanitizeSpokenText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = normalizeForSpeech(raw)
  if (!clean) return null
  if (clean.length > SPOKEN_MAX_CHARS) return null
  return clean
}

/**
 * Équivalent oral d'une réponse produite SANS LLM (repli, verdict quantitatif,
 * garde d'accès). Règle unique et volontairement pauvre : une réponse courte et
 * d'un seul tenant se prononce telle quelle ; tout le reste reste silencieux.
 */
export function spokenFromShortAnswer(text: string): string | null {
  if (typeof text !== 'string') return null
  // Un paragraphe double ou une liste signale une réponse structurée : on ne la
  // lit pas, même si elle tient sous le seuil de longueur.
  if (/\n\s*\n/.test(text)) return null
  if (/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/m.test(text)) return null
  const clean = normalizeForSpeech(text)
  if (!clean) return null
  if (clean.length > SHORT_ANSWER_MAX_CHARS) return null
  return clean
}

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
  'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
]

/** Nombre en toutes lettres jusqu'à seize — au-delà, le chiffre se prononce bien. */
function frenchCount(n: number): string {
  return n >= 0 && n < UNITS.length ? UNITS[n] : String(n)
}

/**
 * Synthèse orale d'un plan de visite quand le LLM n'a pas fourni de
 * `spokenText` — typiquement quand le garde d'invariance `next_visit` reprend
 * la main pour garantir la couverture des contrôles.
 *
 * Gabarit strictement déterministe : il ne trie rien, n'interprète rien, ne
 * crée aucun fait. Il verbalise un compteur déjà certain, et renvoie au détail
 * affiché. Ce n'est pas un second moteur de réponse — c'est `items.length` mis
 * en français.
 */
export function buildSpokenFallback(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "Je n'ai identifié aucun point à vérifier. Le détail est affiché."
  }
  const n = Math.floor(count)
  const noun = n === 1 ? 'point à vérifier' : 'points à vérifier'
  return `J'ai identifié ${frenchCount(n)} ${noun}. Le détail est affiché.`
}
