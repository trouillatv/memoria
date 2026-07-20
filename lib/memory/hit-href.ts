// ── OÙ MÈNE UN RÉSULTAT DE RECHERCHE ────────────────────────────────────────
// Module PUR, volontairement séparé de `lib/db/memory-search.ts` : celui-ci
// importe le client admin (clé service role) et n'a rien à faire dans un bundle
// client. L'overlay ⌘K est un composant client et a besoin de cette règle ;
// c'est la seule raison de ce fichier.

/** Ce dont la destination a besoin — un sous-ensemble structurel de MemoryHit. */
export interface HitLocation {
  type: string
  id: string
  siteId: string | null
  subjectId?: string | null
}

/**
 * Où mène un résultat.
 *
 * Règle : on emmène vers le fil s'il existe. Un fait isolé répond « oui, on en a
 * parlé » ; le fil répond « voilà toute l'histoire » — c'est ce que Guillaume
 * cherche vraiment quand il demande « on avait déjà vu ça ? ».
 *
 * Exception, et elle prime : les objets qui ont une ADRESSE À EUX s'ouvrent
 * eux-mêmes.
 */
export function memoryHitHref(hit: HitLocation): string {
  // Un document se lit DANS SA FICHE — jamais réduit à son extrait.
  if (hit.type === 'document') return `/documents/${hit.id}`

  if (!hit.siteId) return '/sites'

  // ── LES OBJETS QUI ONT UNE ADRESSE CANONIQUE ──────────────────────────────
  // Jusqu'ici, chercher une Décision menait à l'accueil du chantier : on
  // trouvait le bon objet et on le perdait en l'ouvrant. Le motif invoqué —
  // « pas de deep-link par objet » — était vrai tant qu'aucun objet n'avait
  // d'adresse. Décision et Action en ont une depuis l'ADR de navigation.
  //
  // Ces deux-là passent AVANT la règle du fil, et c'est délibéré : la fiche
  // porte désormais son propre fil (position dans la chaîne + relation
  // d'identité). Substituer le sujet à l'objet répondrait à côté de la question
  // posée — on a cherché une décision, pas son sujet.
  //
  // Aucun autre type n'est ajouté ici : leur modèle de navigation n'est pas
  // défini, et le repli vers le chantier reste honnête jusque-là.
  if (hit.type === 'site_decision') return `/sites/${hit.siteId}/decision/${hit.id}`
  if (hit.type === 'site_action') return `/sites/${hit.siteId}/action/${hit.id}`
  // Lot 4 — la Réunion a son adresse. Elle ouvre la RÉUNION, pas le chantier qui
  // la contient ni l'espace de travail de son compte-rendu.
  if (hit.type === 'meeting') return `/sites/${hit.siteId}/reunion/${hit.id}`

  // Le sujet EST le fil.
  if (hit.type === 'subject') return `/sites/${hit.siteId}/subjects/${hit.id}`

  // Un fait rattaché à un sujet : on ouvre le fil, pas le fait isolé.
  if (hit.subjectId) return `/sites/${hit.siteId}/subjects/${hit.subjectId}`

  // Sinon la fiche chantier, qui agrège la mémoire.
  return `/sites/${hit.siteId}`
}
