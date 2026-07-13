// Le nom d'une prestation — et la fragmentation silencieuse qu'il faut empêcher.
//
// Guillaume écrit « Nettoyage magasin ». Trois mois plus tard, sur un autre
// chantier, il écrit « Nettoyage Magasin ». Puis « nettoyage  magasin ». Puis
// « Nettoyage magasin » avec un accent en trop.
//
// Rien ne casse. Rien n'alerte. Et la mémoire se fragmente : quatre prestations
// pour un seul travail, quatre recherches à faire au lieu d'une, et un jour la
// question « combien de nettoyages de magasin fait-on ? » n'a plus de réponse.
//
// C'est le pire type de dégât pour un produit de mémoire : il est INVISIBLE.
//
// D'où deux règles, pures et testées :
//   • on COMPARE sans casse, sans accents, sans espaces en trop ;
//   • quand un nom PROCHE existe, on le PROPOSE — sans jamais l'imposer.
//     « Nettoyage grandes surfaces » et « nettoyage grande surface » sont
//     peut-être deux vrais travaux différents : c'est lui qui sait.

/**
 * La forme canonique d'un nom, pour la COMPARAISON uniquement.
 *
 * Jamais pour l'affichage : on garde toujours l'orthographe de l'utilisateur.
 * C'est la sienne, elle veut dire quelque chose pour lui.
 */
export function normalizePrestation(name: string): string {
  return name
    .normalize('NFD') // sépare les accents de leurs lettres
    .replace(/[̀-ͯ]/g, '') // …et les retire
    .toLowerCase()
    .replace(/\s+/g, ' ') // « nettoyage  magasin » = « nettoyage magasin »
    .trim()
}

/** Deux noms désignent-ils le même travail, à la typographie près ? */
export function samePrestation(a: string, b: string): boolean {
  return normalizePrestation(a) === normalizePrestation(b)
}

/**
 * Un nom déjà employé qui désigne le MÊME travail — s'il existe.
 *
 * On ne fait pas de « ressemblance » floue : « Nettoyage » et « Nettoyage des
 * vitres » sont deux travaux, et une distance de Levenshtein ne le sait pas.
 * On ne rapproche que ce qui est IDENTIQUE à la typographie près. Rapprocher
 * trop serait pire que ne pas rapprocher : on fusionnerait deux vrais métiers.
 */
export function findExistingPrestation(name: string, known: string[]): string | null {
  const target = normalizePrestation(name)
  if (!target) return null
  return known.find((k) => normalizePrestation(k) === target) ?? null
}

/**
 * Faut-il PROPOSER une prestation existante avant de créer ?
 *
 * Oui uniquement quand elle désigne le même travail MAIS s'écrit autrement :
 * c'est le seul cas où l'utilisateur est sur le point de fragmenter sa mémoire
 * sans le savoir. Si l'orthographe est exactement la même, il n'y a rien à
 * signaler — on réutilise, en silence.
 */
export function suggestExisting(name: string, known: string[]): string | null {
  const found = findExistingPrestation(name, known)
  if (!found) return null
  return found === name.trim() ? null : found
}
