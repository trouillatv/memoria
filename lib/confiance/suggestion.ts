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
 * LA POLITIQUE, EN UN SEUL ENDROIT.
 *
 * Ces deux nombres ne sont pas des détails d'implémentation : ils disent à
 * partir de quand MemorIA agit à la place de quelqu'un. Les déplacer change le
 * produit, pas le code — c'est pour ça qu'ils sont nommés, exportés et testés.
 */
export const SEUILS_CONFIANCE = {
  /** ≥ : l'écran peut pré-remplir. En dessous, il demande. */
  preRemplir: 90,
  /** ≥ : on propose. En dessous, on se tait plutôt que de faire du bruit. */
  proposer: 70,
} as const

/** Traduit un score en ce qu'on a le droit d'en faire. */
export function qualifier(score: number): { confiance: NiveauConfiance; action: ActionSuggeree } {
  if (score >= SEUILS_CONFIANCE.preRemplir) return { confiance: 'forte', action: 'pre-remplir' }
  if (score >= SEUILS_CONFIANCE.proposer) return { confiance: 'faible', action: 'demander' }
  return { confiance: 'faible', action: 'ignorer' }
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
