// RECONNAÎTRE QUELQU'UN QU'ON CONNAÎT DÉJÀ — sans IA, et en sachant le dire.
//
// LE PROBLÈME : « Yann », « Y. Martin » et « Yann Martin » créent aujourd'hui
// TROIS contacts. `findOrCreateCompanyContact` ne rapproche que par égalité
// exacte du nom (`ilike` sans joker) au sein d'une entreprise. Chaque visite
// ajoute donc une variante, et la mémoire se fragmente — silencieusement, et
// d'autant plus vite que le produit sert.
//
// ── ON PRÉVIENT, ON NE RÉPARE PAS ──────────────────────────────────────────
//
// Fusionner deux contacts après coup est une opération DESTRUCTIVE : il faut
// choisir lequel survit, recoller les liens, et personne ne peut vérifier
// après. Ce module ne fusionne rien. Il sert à ce que la deuxième variante
// n'existe jamais : au moment où l'on s'apprête à saisir « Yann », il propose
// « Yann Martin (AGP) — déjà connu », et l'humain reconnaît ou passe.
//
// ── POURQUOI PAS LE LLM ────────────────────────────────────────────────────
//
// Un modèle répondrait très bien à « Y. Martin est-il Yann Martin ? ». Mais :
//   · il coûte un appel par acteur, à chaque visite, pour une question que
//     trois règles tranchent ;
//   · il n'est pas reproductible — deux visites peuvent trancher différemment ;
//   · il ne sait pas EXPLIQUER, or c'est une association qu'un humain valide.
// Le LLM garde ce qu'il fait mieux : les acteurs jamais vus. (Cf. la doctrine
// « retrieval d'abord, LLM encadré ensuite ».)
//
// ── CE QUI SORT : UN SCORE ET SA RAISON, JAMAIS UN SCORE SEUL ──────────────
//
// « Confiance 98 % » sans motif est un chiffre qu'on croit ou qu'on ignore.
// Chaque rapprochement porte donc la RÈGLE qui l'a produit, en toutes lettres,
// pour que l'écran puisse dire pourquoi il propose ça.

/** Comment deux noms se sont reconnus. L'ordre est celui de la certitude. */
export type RegleRapprochement =
  /** Les deux noms sont le même, aux accents et à la casse près. */
  | 'identique'
  /** « Yann Martin » contre « Y. Martin » : initiale + nom de famille. */
  | 'initiale-et-nom'
  /** « Yann » contre « Yann Martin » : l'un est le prénom seul de l'autre. */
  | 'prenom-seul'
  /** Une faute de frappe : une seule lettre les sépare. */
  | 'orthographe-proche'

export interface Rapprochement<T> {
  candidat: T
  regle: RegleRapprochement
  /** 0 à 100. Sert à ORDONNER et à afficher, jamais à décider seul. */
  score: number
  /** La phrase que l'écran peut montrer telle quelle. */
  motif: string
}

/** Un acteur déjà connu, réduit à ce qui sert à le reconnaître. */
export interface ActeurConnu {
  id: string
  nom: string
  /** L'entreprise de rattachement, si c'est une personne. */
  entreprise?: string | null
}

/**
 * Casse, accents et ponctuation retirés. « Y. MARTIN » et « y martin » doivent
 * se rencontrer avant qu'on compare quoi que ce soit.
 */
export function normaliserNom(nom: string): string {
  return (nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Les mots d'un nom, vides retirés. */
function mots(nom: string): string[] {
  return normaliserNom(nom).split(' ').filter(Boolean)
}

/**
 * Distance de Levenshtein, bornée : au-delà de `max` on arrête de compter.
 *
 * La borne n'est pas qu'une optimisation — elle dit l'intention. On ne cherche
 * pas « à quel point ces noms diffèrent », on cherche « est-ce une faute de
 * frappe ». Au-delà d'une lettre ou deux, la question ne se pose plus.
 */
export function distance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const courante = [i]
    let minLigne = i
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(courante[j - 1]! + 1, precedente[j]! + 1, precedente[j - 1]! + cout)
      courante.push(v)
      if (v < minLigne) minLigne = v
    }
    // Toute la ligne dépasse la borne : aucune suite ne peut redescendre.
    if (minLigne > max) return max + 1
    precedente = courante
  }
  return precedente[b.length]!
}

/**
 * Ces deux noms désignent-ils probablement la même personne ? `null` si rien
 * ne permet de le dire — l'absence de réponse est une réponse.
 *
 * PRUDENCE ASSUMÉE SUR LE PRÉNOM SEUL : « Yann » rapproché de « Yann Martin »
 * vaut 70, pas 95. Sur un chantier il peut y avoir deux Yann, et la règle ne
 * sait pas les distinguer. C'est assez pour PROPOSER, jamais pour décider — et
 * c'est bien pour ça que rien ici n'écrit.
 */
export function comparerNoms(a: string, b: string): { regle: RegleRapprochement; score: number } | null {
  const na = normaliserNom(a)
  const nb = normaliserNom(b)
  if (!na || !nb) return null
  if (na === nb) return { regle: 'identique', score: 100 }

  const ma = mots(na)
  const mb = mots(nb)

  // « Yann Martin » ↔ « Y Martin » : même nom de famille, prénom réduit à son
  // initiale. Très sûr, parce que le nom de famille est entier des deux côtés.
  if (ma.length >= 2 && mb.length >= 2) {
    const familleA = ma[ma.length - 1]!
    const familleB = mb[mb.length - 1]!
    if (familleA === familleB) {
      const prenomA = ma[0]!
      const prenomB = mb[0]!
      if (prenomA === prenomB) return { regle: 'identique', score: 100 }
      const initialeSurUn = (prenomA.length === 1 && prenomB.startsWith(prenomA))
        || (prenomB.length === 1 && prenomA.startsWith(prenomB))
      if (initialeSurUn) return { regle: 'initiale-et-nom', score: 90 }
    }
  }

  // « Yann » ↔ « Yann Martin » : un seul mot, qui EST le prénom de l'autre.
  const [court, long] = ma.length <= mb.length ? [ma, mb] : [mb, ma]
  if (court.length === 1 && long.length >= 2 && court[0] === long[0]) {
    return { regle: 'prenom-seul', score: 70 }
  }

  // Faute de frappe. Exigence de longueur : sur des noms courts, une lettre
  // change tout — « Luc » et « Duc » ne sont pas la même personne.
  if (na.length >= 5 && nb.length >= 5 && distance(na, nb, 1) <= 1) {
    return { regle: 'orthographe-proche', score: 80 }
  }

  return null
}

const MOTIFS: Record<RegleRapprochement, string> = {
  'identique': 'même nom',
  'initiale-et-nom': 'même nom de famille, prénom en initiale',
  'prenom-seul': 'même prénom — à vérifier',
  'orthographe-proche': 'orthographe très proche',
}

/**
 * Les acteurs connus qui ressemblent à ce nom, du plus sûr au moins sûr.
 *
 * L'ENTREPRISE FAIT PENCHER, ELLE NE TRANCHE PAS. Deux personnes du même nom
 * dans la même société sont bien plus probablement la même que deux homonymes
 * de sociétés différentes. Le bonus reste modeste (+8) : il ordonne la liste,
 * il ne fabrique pas une certitude.
 */
export function rapprocher<T extends ActeurConnu>(
  nom: string,
  connus: readonly T[],
  options: { entreprise?: string | null; minimum?: number; limite?: number } = {},
): Array<Rapprochement<T>> {
  const minimum = options.minimum ?? 70
  const entrepriseCherchee = options.entreprise ? normaliserNom(options.entreprise) : null

  const out: Array<Rapprochement<T>> = []
  for (const candidat of connus) {
    const trouve = comparerNoms(nom, candidat.nom)
    if (!trouve) continue
    const memeEntreprise = Boolean(
      entrepriseCherchee && candidat.entreprise && normaliserNom(candidat.entreprise) === entrepriseCherchee,
    )
    const score = Math.min(100, trouve.score + (memeEntreprise ? 8 : 0))
    if (score < minimum) continue
    out.push({
      candidat,
      regle: trouve.regle,
      score,
      motif: memeEntreprise ? `${MOTIFS[trouve.regle]}, et même entreprise` : MOTIFS[trouve.regle],
    })
  }

  // Score décroissant ; à score égal, l'ordre d'entrée est conservé — un tri
  // instable ferait changer la proposition d'une visite à l'autre sans raison.
  return out
    .sort((x, y) => y.score - x.score)
    .slice(0, options.limite ?? 5)
}
