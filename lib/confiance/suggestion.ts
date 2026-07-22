// LE VOCABULAIRE COMMUN DES RAPPROCHEMENTS — score, motif, confiance, action.
//
// MemorIA va rapprocher beaucoup de choses : deux écritures d'une personne,
// deux d'une entreprise, une abréviation et son terme (« FP » / « faux
// plafond »), deux actions reformulées, deux photos du même équipement. Les
// RÈGLES de rapprochement, elles, n'ont rien à voir entre elles — comparer
// « Y. Martin » à « Yann Martin » n'a aucun rapport avec déplier « CCTP ».
//
// ── CE QUI EST COMMUN N'EST PAS L'ALGORITHME, C'EST LE CONTRAT ─────────────
//
// Vouloir UN moteur qui reconnaisse à la fois les gens, les sociétés et le
// glossaire produirait une fonction qui fait mal les trois. Ce qui se partage
// vraiment tient en quatre choses :
//
//   · un SCORE, comparable d'un moteur à l'autre ;
//   · un MOTIF en toutes lettres — un « 92 % » sans raison est un chiffre
//     qu'on croit ou qu'on ignore, jamais qu'on vérifie ;
//   · une CONFIANCE, qui traduit le score en mot ;
//   · une ACTION, qui dit ce que l'écran a le droit de faire.
//
// Ce module ne porte donc AUCUNE règle de comparaison. Il porte la politique :
// à partir de quel score a-t-on le droit de remplir à la place de quelqu'un.
//
// ── POURQUOI LA POLITIQUE VIT ICI, ET PAS DANS LES ÉCRANS ─────────────────
//
// Le seuil de pré-remplissage a d'abord vécu dans un composant, écrit
// `score >= 90` au milieu du rendu. Une décision produit — « à partir de quand
// MemorIA remplit-il à la place de l'humain ? » — était donc invisible, non
// testable, et impossible à ajuster sans relire du JSX. Elle est ici, seule,
// nommée, et le jour où l'on juge le prénom seul trop permissif, on change un
// nombre sans toucher à un seul algorithme.

/** Ce que vaut un rapprochement, dit avec un mot plutôt qu'un nombre. */
export type NiveauConfiance = 'forte' | 'moyenne' | 'faible'

/** Ce que l'écran a le droit de faire de ce rapprochement. */
export type ActionSuggeree =
  /** Assez sûr pour remplir à la place de l'humain — qui peut toujours corriger. */
  | 'pre-remplir'
  /** Plausible, pas certain : on montre, on ne remplit pas. */
  | 'demander'
  /** Sous le bruit de fond : on ne montre même pas. */
  | 'ignorer'

/**
 * ── DEUX AXES, PAS UN (Vincent, 2026-07-22) ────────────────────────────────
 *
 * La CONFIANCE et la DÉCISION ne sont pas la même chose, et la première
 * version les confondait : `qualifier()` rendait les deux d'un bloc, si bien
 * qu'aucun appelant ne pouvait appliquer une autre politique. Le niveau
 * « faible » couvrait même à la fois « on demande » et « on ignore » — deux
 * situations opposées sous un seul mot.
 *
 *   · la CONFIANCE est une propriété du rapprochement : « à quel point
 *     suis-je sûr ? ». Elle ne dépend de personne, et ne change pas selon
 *     l'écran qui la lit.
 *   · la DÉCISION est une politique métier : « qu'a-t-on le droit d'en
 *     faire ? ». Elle dépend du contexte, et elle a vocation à diverger —
 *     un même 97 peut pré-remplir ici, et ailleurs pré-remplir ET lier ET
 *     notifier.
 *
 * Les séparer maintenant coûte quinze lignes. Les séparer quand cinq moteurs
 * en dépendront coûterait une refonte.
 */

/** La politique : à partir de quel score agit-on ? Remplaçable par contexte. */
export interface PolitiqueDecision {
  /** ≥ : on peut remplir à la place de l'humain. */
  preRemplir: number
  /** ≥ : on propose. En dessous, on se tait plutôt que de faire du bruit. */
  proposer: number
}

/**
 * La politique par défaut. Ces deux nombres disent à partir de quand MemorIA
 * agit à la place de quelqu'un : les déplacer change le produit, pas le code.
 */
export const POLITIQUE_PAR_DEFAUT: PolitiqueDecision = {
  preRemplir: 90,
  proposer: 70,
}

/** Conservé sous son ancien nom : la politique par défaut EST le seuil commun. */
export const SEUILS_CONFIANCE = POLITIQUE_PAR_DEFAUT

/**
 * À quel point est-on sûr — indépendamment de ce qu'on en fera. Trois niveaux
 * réellement distincts : « moyenne » n'est pas « faible », c'est justement le
 * cas où l'on montre sans remplir.
 */
export function confianceDe(score: number): NiveauConfiance {
  if (score >= POLITIQUE_PAR_DEFAUT.preRemplir) return 'forte'
  if (score >= POLITIQUE_PAR_DEFAUT.proposer) return 'moyenne'
  return 'faible'
}

/** Ce qu'on a le droit d'en faire — la politique, pas la certitude. */
export function decider(score: number, politique: PolitiqueDecision = POLITIQUE_PAR_DEFAUT): ActionSuggeree {
  if (score >= politique.preRemplir) return 'pre-remplir'
  if (score >= politique.proposer) return 'demander'
  return 'ignorer'
}

/** Les deux d'un coup, pour les appelants qui n'ont pas de politique propre. */
export function qualifier(
  score: number,
  politique: PolitiqueDecision = POLITIQUE_PAR_DEFAUT,
): { confiance: NiveauConfiance; action: ActionSuggeree } {
  return { confiance: confianceDe(score), action: decider(score, politique) }
}

/**
 * Un rapprochement proposé, quel que soit le moteur qui l'a produit.
 *
 * `origine` n'est pas décoratif : quand deux moteurs proposeront la même chose
 * pour des raisons différentes, c'est lui qui permettra de dire laquelle on
 * regarde — et de débrancher un moteur sans deviner ce qu'il produisait.
 */
export interface Suggestion<T> {
  candidat: T
  /** 0 à 100. Sert à ORDONNER et à afficher, jamais à décider seul. */
  score: number
  /** La phrase que l'écran peut montrer telle quelle. */
  motif: string
  confiance: NiveauConfiance
  action: ActionSuggeree
  /** Quel moteur l'a produite, ex. « acteurs/identite ». */
  origine: string
}
