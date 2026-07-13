// Lot D — « Retirer » : la DÉCISION, pure et testable.
//
// Doctrine (audit/03-delete-strategy.md, validée Vincent) :
//
//     Jamais de suppression visible.
//              ↓
//          RETIRER   (le seul verbe que voit l'utilisateur)
//              ↓
//         Archiver   (l'objet sort des écrans, la mémoire reste)
//
// La mémoire est l'actif du produit : **une preuve n'est jamais détruite par
// un geste de rangement**. Le hard delete est réservé aux brouillons SANS
// descendance (l'essai de Guillaume qui n'aurait jamais dû exister).
//
// Ici on décide seulement ; les écritures vivent dans lib/db/*, les gardes
// (rôle + organisation) dans les server actions.

export type RemovalMode = 'hard' | 'soft'

export type RemovalDecision =
  | { allowed: true; mode: RemovalMode; consequence: string }
  | { allowed: false; reason: string }

/**
 * MISSION.
 * - zéro intervention → essai pur, aucune mémoire à préserver : hard delete.
 * - sinon → soft. Un hard detruirait les interventions (FK ON DELETE CASCADE,
 *   mig 018:66) et avec elles les photos-preuves. Jamais.
 */
export function decideMissionRemoval(interventionCount: number): RemovalDecision {
  if (interventionCount <= 0) {
    return {
      allowed: true,
      mode: 'hard',
      consequence: 'Cette mission n’a aucune intervention — elle sera supprimée définitivement.',
    }
  }
  const n = interventionCount
  return {
    allowed: true,
    mode: 'soft',
    consequence:
      `Cette mission sort de vos écrans. Ses ${n} intervention${n > 1 ? 's' : ''} ` +
      `et leurs preuves restent conservées.`,
  }
}

/**
 * CLIENT.
 * - au moins un site actif → BLOQUÉ, avec le nombre exact. `sites.client_id` est
 *   en ON DELETE CASCADE (mig 003:19) : la cascade irait client → sites →
 *   missions → interventions → photos. On ne l'expose jamais, même en soft :
 *   un client sans ses sites n'a pas de sens.
 * - aucun site actif → soft (archivage). Jamais de hard : le client peut être
 *   cité dans l'historique.
 */
export function decideClientRemoval(activeSiteCount: number): RemovalDecision {
  if (activeSiteCount > 0) {
    const n = activeSiteCount
    return {
      allowed: false,
      reason:
        `Ce client a ${n} chantier${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}. ` +
        `Retirez-${n > 1 ? 'les' : 'le'} d’abord — l’historique d’un chantier ne se supprime pas avec son client.`,
    }
  }
  return {
    allowed: true,
    mode: 'soft',
    consequence: 'Ce client sort de vos écrans. Son historique reste conservé.',
  }
}
