// Contrôle du contrat oral : la voix suit-elle la hiérarchie du moteur ?
//
// Doctrine figée par Vincent (2026-08-15) : « MemorIA décide de l'attention.
// L'IA formule l'attention. » Traduit en règle vérifiable :
//
//   La voix peut ne détailler que 2 ou 3 contrôles sur 5, mais elle doit
//   ANNONCER qu'il y en a 5, et les contrôles qu'elle verbalise doivent être
//   les tout PREMIERS de l'ordre calculé par le moteur — jamais une sélection
//   libre du LLM.
//
// Module pur, sans DOM ni réseau : il sert à la fois aux tests unitaires (le
// contrat) et au harnais de diagnostic terrain (la mesure). Une seule
// implémentation, donc la recette mesure exactement ce que les tests exigent.

/** Comparaison insensible aux accents, à la casse et à la ponctuation. */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Mots vides trop courts pour être filtrés par la longueur seule.
 *
 * Sans cette liste, « pour » — présent dans un seul libellé — devenait le mot
 * qui l'identifie, et la phrase « cinq points ressortent POUR demain » suffisait
 * à le déclarer cité, en tête de surcroît. Un mot grammatical n'identifie jamais
 * un contrôle : il n'appartient qu'accidentellement à un seul label.
 */
const STOP_WORDS = new Set([
  'pour', 'avec', 'sans', 'dans', 'chez', 'vers', 'sous', 'entre', 'depuis',
  'selon', 'apres', 'avant', 'lors', 'hors', 'leur', 'leurs', 'cette', 'ces',
  'ceux', 'celle', 'celles', 'dont', 'plus', 'tout', 'tous', 'toute', 'toutes',
  'aussi', 'mais', 'donc', 'meme', 'memes', 'autre', 'autres', 'etre', 'sont',
  'elle', 'elles', 'quoi', 'quel', 'quelle', 'nouveau', 'nouvelle',
])

/**
 * Mots DISCRIMINANTS de chaque label : ceux qu'aucun autre label ne porte.
 *
 * Une proportion de mots communs ne marche pas ici. Le LLM abrège (« la dépose
 * du SSI » pour un label de neuf mots), ce qui produirait des faux négatifs ;
 * et plusieurs contrôles d'un même chantier partagent « gestion » ou
 * « matériel », ce qui produirait des faux positifs. Un label sans aucun mot
 * discriminant (deux libellés quasi identiques) est indétectable par
 * construction — il renvoie une liste vide et ne sera jamais compté comme cité.
 */
export function discriminantsOf(labels: string[]): string[][] {
  const wordsPer = labels.map(
    (l) => new Set(
      normalizeLabel(l).split(' ').filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
    ),
  )
  const count = new Map<string, number>()
  for (const set of wordsPer) for (const w of set) count.set(w, (count.get(w) ?? 0) + 1)
  return wordsPer.map((set) => [...set].filter((w) => count.get(w) === 1))
}

const NUM_WORDS = [
  'zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
  'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
]

/**
 * La voix dit-elle COMBIEN de contrôles existent ?
 *
 * C'est la moitié du contrat : sans ce nombre, détailler deux points sur cinq
 * laisse croire que MemorIA n'en a trouvé que deux.
 */
export function announcesControlCount(spoken: string, total: number): boolean {
  const s = normalizeLabel(spoken)
  const word = NUM_WORDS[total]
  if (new RegExp(`\\b${total}\\b`).test(s)) return true
  return !!word && new RegExp(`\\b${word}\\b`).test(s)
}

/**
 * Index (0-based) des contrôles nommés par la voix, **dans leur ordre
 * d'apparition orale** — pas dans l'ordre du moteur. C'est cette différence qui
 * permet ensuite de détecter une réorganisation.
 */
export function mentionedControlIndexes(spoken: string, labels: string[]): number[] {
  const s = normalizeLabel(spoken)
  const discriminants = discriminantsOf(labels)
  const positions: { index: number; at: number }[] = []
  discriminants.forEach((words, index) => {
    const hits = words.map((w) => s.indexOf(w)).filter((p) => p >= 0)
    if (hits.length > 0) positions.push({ index, at: Math.min(...hits) })
  })
  return positions.sort((a, b) => a.at - b.at).map((p) => p.index)
}

export type SpokenOrderCheck = {
  /** Nombre total de contrôles annoncé explicitement. */
  announcesTotal: boolean
  /** Contrôles cités, dans l'ordre où la voix les prononce. */
  mentioned: number[]
  /** Les contrôles cités sont-ils prononcés dans l'ordre du moteur ? */
  followsEngineOrder: boolean
  /**
   * Les contrôles cités sont-ils les tout PREMIERS du moteur (#1, #1-2, #1-2-3) ?
   * Un « oui » sur #1 et #4 signerait une sélection libre du LLM.
   */
  isEnginePrefix: boolean
  /** Contrat complet : annonce l'étendue, cite un préfixe, dans l'ordre. */
  ok: boolean
}

/**
 * Vérifie le contrat oral complet contre l'ordre déterministe du moteur.
 *
 * `labels` DOIT être la liste produite par `buildVisitPlan`, dans son ordre :
 * c'est elle, la hiérarchie métier. Une voix silencieuse (`null`) échoue le
 * contrat sans lever — se taire reste un défaut mesurable, pas une erreur.
 */
export function checkSpokenFollowsEngine(
  spoken: string | null,
  labels: string[],
): SpokenOrderCheck {
  const empty: SpokenOrderCheck = {
    announcesTotal: false, mentioned: [], followsEngineOrder: false,
    isEnginePrefix: false, ok: false,
  }
  if (!spoken || labels.length === 0) return empty

  const mentioned = mentionedControlIndexes(spoken, labels)
  const announcesTotal = announcesControlCount(spoken, labels.length)
  const followsEngineOrder = mentioned.every((v, i) => i === 0 || mentioned[i - 1] < v)
  const sorted = [...mentioned].sort((a, b) => a - b)
  const isEnginePrefix = sorted.length > 0 && sorted.every((v, i) => v === i)

  return {
    announcesTotal,
    mentioned,
    followsEngineOrder,
    isEnginePrefix,
    ok: announcesTotal && followsEngineOrder && isEnginePrefix,
  }
}
