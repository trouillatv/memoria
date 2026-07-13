// Lot S — garde d'appartenance sur les ÉCRITURES : la DÉCISION, pure et testable.
//
// Constat de l'audit (audit/04-rls.md) : toutes les server actions vérifient le
// RÔLE, aucune ne vérifie l'ORGANISATION de l'objet muté. Le service role
// bypassant la RLS, un id d'un autre tenant passé à la main était accepté
// (IDOR d'écriture). Ici on décide ; le fetch vit dans ownership.ts.
//
// Règles :
//   - admin = super-admin PLATEFORME → passe (seule exception, cf. doctrine
//     isolation « fail-closed », l'admin est l'exploitant de MemorIA) ;
//   - objet inexistant → refus (même message qu'un objet d'un autre tenant :
//     on ne révèle pas l'existence d'un objet étranger) ;
//   - appelant sans organisation → refus (FAIL-CLOSED, jamais d'élargissement) ;
//   - objet sans organisation (donnée orpheline) → refus explicite : il est déjà
//     invisible dans toutes les listes (selects fail-closed), le muter à
//     l'aveugle n'aurait aucun sens ;
//   - sinon : égalité stricte des organisations.

import type { UserRole } from '@/types/db'

export interface OwnershipInput {
  role: UserRole
  /** Organisation de l'appelant (null = session sans org). */
  callerOrgId: string | null
  /** Organisation de l'objet ciblé ; undefined si l'objet n'existe pas. */
  objectOrgId?: string | null
}

export type OwnershipDecision =
  | { allowed: true }
  | { allowed: false; error: string }

/** Message unique pour « n'existe pas » ET « autre tenant » — pas d'oracle. */
const NOT_FOUND = 'Objet introuvable'

export function decideOwnership(input: OwnershipInput): OwnershipDecision {
  const { role, callerOrgId, objectOrgId } = input

  if (objectOrgId === undefined) return { allowed: false, error: NOT_FOUND }

  // Super-admin plateforme : seule exception à l'isolation (doctrine).
  if (role === 'admin') return { allowed: true }

  if (!callerOrgId) return { allowed: false, error: 'Session sans organisation' }
  if (!objectOrgId) {
    return { allowed: false, error: 'Objet sans organisation — contactez un administrateur' }
  }
  if (objectOrgId !== callerOrgId) return { allowed: false, error: NOT_FOUND }

  return { allowed: true }
}
