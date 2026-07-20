// ── OÙ MÈNE UN DOCUMENT ──────────────────────────────────────────────────────
// Module PUR, une seule règle, tous les écrans l'appliquent — même principe que
// `lib/memory/hit-href.ts` pour la recherche.
//
// Il existe parce qu'une correction en a cassé une autre : en repointant quatre
// listes vers la fiche du graphe, on a rendu les documents de type `litige`
// INATTEIGNABLES. Le litige est volontairement hors du graphe (il ne se mélange
// pas aux faits de chantier), donc `getSiteDocumentFiche` le refuse et la page
// rend `notFound()`. Avant, ces listes menaient à la visionneuse, qui le sert.
//
// La leçon, et c'est elle qui justifie ce fichier : **une porte ne se déplace pas
// sans emporter les cas que l'ancienne servait.**

/** Ce dont la destination a besoin — sous-ensemble structurel d'un document. */
export interface DocumentLocation {
  id: string
  document_type: string
}

/**
 * L'adresse d'un document.
 *
 * · Dans un chantier → la FICHE du graphe : elle porte le fil, la provenance et
 *   les réserves justifiées, et la visionneuse y reste une sortie nommée.
 * · Un LITIGE → la visionneuse, toujours. Il est exclu du graphe par doctrine ;
 *   l'y envoyer ne le protégerait pas davantage, cela le rendrait introuvable.
 *   Il n'est pas caché, il n'est pas MÉLANGÉ.
 * · Hors chantier → la visionneuse : il n'y a pas de coquille où l'ouvrir.
 */
export function documentHref(doc: DocumentLocation, siteId?: string | null): string {
  if (!siteId || doc.document_type === 'litige') return `/documents/${doc.id}`
  return `/sites/${siteId}/document/${doc.id}`
}
