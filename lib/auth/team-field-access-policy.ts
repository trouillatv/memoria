// ── QUI PEUT GÉRER LES PERSONNES TERRAIN D'UNE ÉQUIPE (Lot 1, 2026-07-27) ─────
// Décision PURE (aucune base, aucun réseau) → prouvable en test unitaire, comme
// `decideOwnership`. La couche action fournit les faits (rôle, org, appartenance)
// et applique la décision ; ici on ne fait que trancher.
//
// Doctrine :
//   - admin / manager : toutes les équipes de LEUR organisation.
//   - chef_equipe     : UNIQUEMENT ses propres équipes (appartenance prouvée par
//                       team_members), et seulement dans son organisation.
//   - tout autre rôle : refusé.
// Dans le doute (hors org, équipe non sienne) : refus. On ne déduit jamais un
// accès du simple fait de connaître l'identifiant d'équipe.

import type { UserRole } from '@/types/db'

export interface TeamFieldAccessFacts {
  role: UserRole | null
  /** L'équipe appartient-elle à l'organisation de l'appelant ? (garde d'org) */
  teamInOrg: boolean
  /** L'appelant est-il réellement membre actif de cette équipe ? (team_members) */
  isMyTeam: boolean
}

export type TeamFieldAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

export function decideTeamFieldAccess(facts: TeamFieldAccessFacts): TeamFieldAccessDecision {
  if (!facts.teamInOrg) {
    return { allowed: false, reason: 'Cette équipe n’appartient pas à votre organisation' }
  }
  if (facts.role === 'admin' || facts.role === 'manager') {
    return { allowed: true }
  }
  if (facts.role === 'chef_equipe') {
    return facts.isMyTeam
      ? { allowed: true }
      : { allowed: false, reason: 'Cette équipe n’est pas la vôtre' }
  }
  return { allowed: false, reason: 'Accès refusé' }
}
