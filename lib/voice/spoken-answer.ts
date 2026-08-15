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

/**
 * Budget oral : ce que MemorIA s'autorise à prononcer d'un trait.
 *
 * 450 caractères ≈ 30 secondes de parole à débit normal — exactement le plafond
 * fixé par Vincent. Relevé de 400 le 2026-08-15 avec la doctrine « verdict puis
 * 1 à 3 faits » : une réponse à une question large ("où en est le chantier ?")
 * tient légitimement en trois ou quatre phrases, et l'ancien seuil l'aurait
 * jetée EN ENTIER — donc rendu MemorIA muette précisément sur les questions où
 * elle a le plus à dire.
 */
export const SPOKEN_MAX_CHARS = 450

/**
 * En deçà, respecter le budget ne conserverait plus l'essentiel : mieux vaut se
 * taire que prononcer un début de réponse qui laisse croire que MemorIA n'a
 * trouvé que ça.
 */
export const SPOKEN_MIN_KEPT_CHARS = 200

/**
 * Applique le budget oral **à frontière sémantique** : on conserve le plus long
 * préfixe constitué de phrases COMPLÈTES qui tient sous le plafond.
 *
 * Ce n'est pas une troncature, et le vocabulaire compte ici — doctrine figée par
 * Vincent le 2026-08-15 : « Une réponse vocale ne doit jamais être coupée au
 * milieu d'une phrase. Si elle dépasse le budget oral, conserver le plus long
 * préfixe constitué de phrases complètes respectant le plafond. Ne jamais
 * inventer une conclusion pour compenser la coupe. » Une troncature ampute ; ici
 * on déplace un point final déjà écrit par le modèle, et on n'ajoute rien.
 *
 * La règle initiale — « trop long : jeté » — supposait le dépassement rare. Le
 * diagnostic PETRO du 2026-08-15 montre l'inverse : sur 17 appels identiques, le
 * modèle produit régulièrement 430 à 500 caractères et cinq réponses ont été
 * jetées EN ENTIER (467, 476, 500…). Une voix muette une fois sur trois, sans
 * trace, se vit comme une panne aléatoire — c'est exactement ce que « ils sont
 * aléatoires suivant la demande » décrivait.
 *
 * Le plafond de 30 secondes est conservé, le silence disparaît. Si aucune phrase
 * complète n'entre sous le plafond (bloc d'un seul tenant), on se tait comme
 * avant : le budget ne s'achète jamais au prix d'une phrase amputée.
 */
function enforceSpokenBudget(clean: string): string | null {
  const head = clean.slice(0, SPOKEN_MAX_CHARS)
  // `[\s\S]*` est gourmand : la capture s'arrête au DERNIER terminateur possible.
  const m = head.match(/^[\s\S]*[.!?…](?=\s|$)/)
  if (!m) return null
  const kept = m[0].trim()
  return kept.length >= SPOKEN_MIN_KEPT_CHARS ? kept : null
}

/**
 * Ancien seuil de rejet binaire des réponses sans LLM. **Supprimé le
 * 2026-08-16**, sur preuve : le diagnostic PETRO a mesuré un verdict quantitatif
 * de 189 caractères — muet pour NEUF caractères de trop. Arbitrage de Vincent :
 * « la réponse la plus fiable de MemorIA devient silencieuse pour 9 caractères…
 * je ne garderais pas un cutoff binaire aussi proche de la distribution
 * réelle. »
 *
 * Le défaut n'était pas la valeur mais la FORME de la règle : un rejet total
 * là où la réponse LLM bénéficiait déjà d'un budget à frontière sémantique.
 * Les deux chemins partagent désormais `SPOKEN_MAX_CHARS`. Constante conservée
 * pour mémoire du diagnostic ; plus aucun code ne la lit.
 *
 * @deprecated remplacé par `SPOKEN_MAX_CHARS` + `enforceSpokenBudget`.
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
 * validation de la réponse : mauvais type ou vide → `null`, jamais une erreur,
 * jamais un repli métier.
 *
 * Au-delà du budget oral, on applique `enforceSpokenBudget` : dernier préfixe de
 * phrases complètes, jamais une coupe en plein milieu d'une phrase.
 */
export function sanitizeSpokenText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = normalizeForSpeech(raw)
  if (!clean) return null
  if (clean.length > SPOKEN_MAX_CHARS) return enforceSpokenBudget(clean)
  return clean
}

/**
 * Équivalent oral d'une réponse produite SANS LLM (repli, verdict quantitatif,
 * garde d'accès).
 *
 * Deux règles, et la distinction entre elles est tout le sujet :
 *
 * 1. **La FORME décide du silence.** Une liste ou un double paragraphe signale
 *    une réponse structurée : on ne lit pas une check-list à voix haute, quelle
 *    que soit sa longueur. Ce refus-là est conservé tel quel.
 * 2. **La LONGUEUR décide de la coupe, pas du silence.** Même budget et même
 *    frontière sémantique que la synthèse orale du LLM : le plus long préfixe de
 *    phrases complètes sous `SPOKEN_MAX_CHARS`.
 *
 * Avant le 2026-08-16, la longueur décidait aussi du silence, avec un rejet
 * binaire à 180 caractères. Un verdict quantitatif de 189 caractères mesuré sur
 * PETRO restait donc muet — sur le chemin le plus exact du Copilote, celui où
 * MemorIA ne fait que compter ce qu'elle sait déjà. Aucune raison de tenir la
 * réponse la plus fiable à un régime plus sévère que la moins fiable.
 */
export function spokenFromShortAnswer(text: string): string | null {
  if (typeof text !== 'string') return null
  if (/\n\s*\n/.test(text)) return null
  if (/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/m.test(text)) return null
  const clean = normalizeForSpeech(text)
  if (!clean) return null
  if (clean.length > SPOKEN_MAX_CHARS) return enforceSpokenBudget(clean)
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
 * crée aucun fait. Ce n'est pas un second moteur de réponse — c'est
 * `items.length` mis en français. C'est le seul cas où MemorIA n'a rien à
 * hiérarchiser, donc le seul où une phrase générique est légitime.
 *
 * La phrase s'arrête sur le compteur : pas de « le détail est affiché ». La voix
 * et l'écran ne sont pas deux systèmes concurrents, l'utilisateur a l'écran sous
 * les yeux, et cette formule méta était la marque d'une voix qui décrit
 * l'interface au lieu de répondre.
 */
export function buildSpokenFallback(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "Je n'ai identifié aucun point à vérifier."
  }
  const n = Math.floor(count)
  const noun = n === 1 ? 'point à vérifier' : 'points à vérifier'
  return `J'ai identifié ${frenchCount(n)} ${noun}.`
}
