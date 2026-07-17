// ── LIRE UNE QUESTION, SANS LLM ──────────────────────────────────────────────
// « Je veux que Question marche et interroge tout. » (Vincent, 2026-07-17)
//
// Le moteur cherchait la QUESTION ENTIÈRE comme sous-chaîne :
//
//     const pattern = `%${q}%`
//     .ilike('body', pattern)
//
// « Quelles ont été les observations ? » était donc cherché littéralement dans le
// texte des captures. Aucun texte ne contient cette phrase — zéro résultat, sans
// erreur. La recherche ne fonctionnait que si l'on tapait déjà le mot exact, ce
// qui suppose de connaître la réponse.
//
// Ce module lit une question de DEUX façons, et les deux sont nécessaires :
//
//   1. Ses TERMES        — « carrelage », « coffret » : ce qu'on cherche.
//   2. Ses CATÉGORIES    — « risques », « décisions » : le RAYON qu'on demande.
//
// La 2ᵉ est le point aveugle. Les exemples proposés par l'écran — « Quels risques
// sont encore ouverts ? », « Quelles décisions concernent ce chantier ? » —
// nomment un rayon, pas un contenu. Le mot « risque » n'apparaît dans aucune
// vigilance ; il les désigne. Chercher « risque » dans le texte ne peut donc rien
// rendre, et l'écran promettait un contrat que le moteur ne tenait pas.
//
// Zéro IA : un vocabulaire fermé, écrit ici, qu'on peut lire et corriger.

/** Mots vides FR + mots INTERROGATIFS. « Quelles ont été les observations ? » ne
 *  laisse que « observations » — le reste est de la grammaire, pas une piste. */
const STOPWORDS = new Set([
  // interrogatifs — le cœur du problème : ils survivaient au découpage
  'quel', 'quels', 'quelle', 'quelles', 'qui', 'quoi', 'quand', 'comment', 'pourquoi',
  'combien', 'est', 'ce', 'que', 'qu', 'ou', 'dont', 'lequel', 'laquelle',
  // grammaire
  'les', 'des', 'une', 'un', 'le', 'la', 'de', 'du', 'au', 'aux', 'et', 'en', 'a',
  'avec', 'dans', 'pour', 'cette', 'cet', 'ces', 'son', 'sa', 'ses', 'sont', 'mais',
  'plus', 'tout', 'tous', 'toute', 'toutes', 'leur', 'leurs', 'etre', 'avoir',
  'sans', 'sous', 'entre', 'vers', 'chez', 'donc', 'alors', 'aussi', 'comme',
  'cela', 'celui', 'celle', 'encore', 'depuis', 'apres', 'avant', 'pendant',
  'selon', 'elles', 'nous', 'vous', 'elle', 'il', 'ils', 'notre', 'votre', 'ont',
  'ete', 'par', 'sur', 'ainsi', 'meme', 'tres', 'bien', 'deja', 'etait', 'etaient',
  'sera', 'seront', 'faut', 'peut', 'doit', 'y', 'se', 'ne', 'pas', 'me', 'mon',
  // bruit générique du domaine : présent partout, ne discrimine rien
  'site', 'chantier', 'concerne', 'concernent', 'savoir', 'ouvert', 'ouverts',
  'ouverte', 'ouvertes',
])

/** Le rayon demandé par la question. Fermé volontairement : chaque entrée est un
 *  objet métier réel, pas une intention devinée. */
export type QueryCategory =
  | 'observation'
  | 'watchpoint'
  | 'decision'
  | 'action'
  | 'deadline'
  | 'stakeholder'
  | 'photo'
  | 'knowledge'
  | 'proposal'

/** Les mots par lesquels un conducteur NOMME un rayon. Le singulier suffit : la
 *  normalisation ne lemmatise pas, alors on liste les formes réellement dites. */
const CATEGORY_WORDS: Record<QueryCategory, string[]> = {
  observation: ['observation', 'observations', 'constat', 'constats', 'releve', 'releves', 'vu', 'note', 'notes'],
  watchpoint: ['risque', 'risques', 'vigilance', 'vigilances', 'danger', 'dangers', 'reserve', 'reserves', 'alerte', 'alertes'],
  decision: ['decision', 'decisions', 'arbitrage', 'arbitrages', 'decide', 'decides'],
  action: ['action', 'actions', 'tache', 'taches', 'todo', 'faire'],
  deadline: ['echeance', 'echeances', 'delai', 'delais', 'date', 'dates', 'planning', 'quand'],
  stakeholder: ['intervenant', 'intervenants', 'entreprise', 'entreprises', 'equipe', 'equipes', 'connait', 'contact', 'contacts', 'acteur', 'acteurs'],
  photo: ['photo', 'photos', 'image', 'images', 'video', 'videos'],
  knowledge: ['information', 'informations', 'infos', 'connaissance', 'connaissances'],
  proposal: ['confirmer', 'proposition', 'propositions', 'propose', 'proposees', 'attente'],
}

/** Sans accents, sans ponctuation, en minuscules — « Échéance » et « echeance »
 *  sont le même mot pour un conducteur pressé sur un téléphone. */
export function normalizeQuery(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Les termes CHERCHABLES d'une question — ce qui reste quand on retire la
 * grammaire. « Quelles ont été les observations ? » → ['observations'].
 * « Où en est le coffret électrique ? » → ['coffret', 'electrique'].
 *
 * Deux caractères minimum : « m2 » est un terme, « d' » n'en est pas un.
 */
export function queryTerms(q: string): string[] {
  const out: string[] = []
  for (const tok of normalizeQuery(q).split(' ')) {
    if (tok.length < 2 || STOPWORDS.has(tok)) continue
    if (!out.includes(tok)) out.push(tok)
  }
  return out
}

/**
 * Les rayons NOMMÉS par la question. Vide si la question ne nomme aucun rayon —
 * on ne devine pas : « Où en est le coffret ? » est une recherche par terme, pas
 * une demande de catégorie.
 */
export function queryCategories(q: string): QueryCategory[] {
  const words = new Set(normalizeQuery(q).split(' '))
  const out: QueryCategory[] = []
  for (const [cat, vocab] of Object.entries(CATEGORY_WORDS) as Array<[QueryCategory, string[]]>) {
    if (vocab.some((w) => words.has(w))) out.push(cat)
  }
  return out
}

/**
 * La question est-elle une DEMANDE DE RAYON pure ?
 *
 * « Quelles ont été les observations ? » ne laisse que le mot du rayon : il n'y a
 * rien d'autre à chercher, il faut donc rendre le rayon ENTIER. Alors que « Quelles
 * observations sur le carrelage ? » nomme un rayon ET un terme : là, on filtre.
 *
 * La distinction compte : sans elle, on renverrait tout le chantier dès qu'une
 * question contient le mot « action ».
 */
export function isCategoryOnlyQuestion(q: string): boolean {
  const cats = queryCategories(q)
  if (cats.length === 0) return false
  const vocab = new Set(cats.flatMap((c) => CATEGORY_WORDS[c]))
  // Il ne reste aucun terme qui ne soit pas le nom du rayon lui-même.
  return queryTerms(q).every((t) => vocab.has(t))
}
