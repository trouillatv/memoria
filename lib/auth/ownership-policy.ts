// Lot S / M3-B — garde d'appartenance sur les ÉCRITURES : la DÉCISION, pure et testable.
//
// Constat de l'audit (audit/04-rls.md) : toutes les server actions vérifient le
// RÔLE, aucune ne vérifie l'ORGANISATION de l'objet muté. Le service role
// bypassant la RLS, un id d'un autre tenant passé à la main était accepté
// (IDOR d'écriture). Ici on décide ; le fetch + la lecture d'appartenance vivent
// dans ownership.ts.
//
// ── DOCTRINE M3-B : PLATEFORME ≠ MÉTIER, ORG DE LA RESSOURCE ────────────────
// L'ancienne version comparait l'org de l'objet à l'org PAR DÉFAUT de l'appelant
// et EXEMPTAIT `role === 'admin'` — un admin plateforme pouvait donc écrire sur
// la ressource de n'importe quelle organisation. C'était le contournement que
// M2C devait fermer (isolation-tenants-fail-closed : plateforme ≠ métier).
//
// Désormais la décision ne connaît que DEUX faits, tous deux résolus en amont :
//   - l'organisation DE L'OBJET muté ;
//   - l'appelant est-il MEMBRE ACTIF de CETTE organisation ?
// Aucune exemption de rôle, aucune org choisie par l'appelant. Le rôle métier
// (manager/admin) reste gardé EN AMONT par `requireManagerOrAdmin`.
//
// Règles :
//   - objet inexistant → refus (même message qu'un objet étranger : pas d'oracle) ;
//   - objet sans organisation (orphelin) → refus explicite ;
//   - appelant non membre de l'org de l'objet → refus (même message qu'inexistant) ;
//   - sinon → autorisé.

export interface OwnershipInput {
  /** Organisation de l'objet ciblé ; undefined si l'objet n'existe pas. */
  objectOrgId?: string | null
  /** L'appelant est-il MEMBRE ACTIF de l'organisation DE L'OBJET ? Résolu en
   *  amont (ownership.ts) via `requireOrganizationMembership(objectOrgId)` —
   *  jamais une comparaison à l'org du caller, jamais une exemption de rôle. */
  isMemberOfObjectOrg: boolean
}

export type OwnershipDecision =
  | { allowed: true }
  | { allowed: false; error: string }

/** Message unique pour « n'existe pas », « autre tenant » ET « non membre » — pas d'oracle. */
const NOT_FOUND = 'Objet introuvable'

export function decideOwnership(input: OwnershipInput): OwnershipDecision {
  const { objectOrgId, isMemberOfObjectOrg } = input

  if (objectOrgId === undefined) return { allowed: false, error: NOT_FOUND }
  if (!objectOrgId) {
    return { allowed: false, error: 'Objet sans organisation — contactez un administrateur' }
  }
  // Non membre de l'org DE L'OBJET → traité comme « introuvable » (aucun oracle
  // sur l'existence d'une ressource étrangère). Vrai aussi pour un admin
  // plateforme sans appartenance : plus aucune exemption.
  if (!isMemberOfObjectOrg) return { allowed: false, error: NOT_FOUND }

  return { allowed: true }
}
