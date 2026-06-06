// Page Intervenants — accès & kill switch.
//
// Vincent 2026-05-21 — pivot doctrinal documenté dans la mémoire projet
// `page-personne-pivot-transgression`. Routes /intervenants et
// /intervenants/[id] accessibles à manager+admin sous 6 garde-fous
// techniques minimum (cf. mémoire dédiée).
//
// Garde-fou #5 — KILL SWITCH : variable d'environnement
// `INTERVENANTS_PAGE_ENABLED` (default false). En cas d'incident, l'admin
// met la variable à `false` et redémarre — toutes les routes /intervenants*
// renvoient 404, le code reste prêt à réactivation.
//
// Garde-fou #1 — AUDIT LOG : chaque consultation par un user qui n'est pas
// le sujet lui-même DOIT être loggée via logAuditEvent (côté caller).

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { canViewerAccessIntervenantInScope } from '@/lib/db/intervenants'
import type { DbUser, UserRole } from '@/types/db'

/**
 * La feature « page Intervenants » est-elle activée pour ce déploiement ?
 *
 * Source unique de vérité : variable d'environnement. Pas de table BDD pour
 * pouvoir désactiver SANS redéploiement (set ENV var + restart).
 */
export function isIntervenantsPageEnabled(): boolean {
  return process.env.INTERVENANTS_PAGE_ENABLED === 'true'
}

/** Rôles autorisés à consulter une page Intervenant autre que la leur. */
const PRIVILEGED_ROLES: ReadonlyArray<UserRole> = ['admin', 'manager']

export interface IntervenantsPageAccess {
  /** L'utilisateur courant. Toujours non-null si access.allowed === true. */
  viewer: DbUser
  /** True si viewer consulte SA propre page (self-consultation, OK). */
  isSelf: boolean
  /** True si viewer est admin ou manager (consultation privilégiée). */
  isPrivileged: boolean
}

export type IntervenantsPageAccessResult =
  | { allowed: true; access: IntervenantsPageAccess }
  | { allowed: false; reason: 'disabled' | 'unauthenticated' | 'forbidden' }

/**
 * Vérifie l'accès à une page Intervenants (liste ou détail).
 *
 * Pour la PAGE LISTE (`/intervenants`), passer null à targetUserId — seuls
 * manager+admin peuvent y accéder (jamais chef_equipe). Pour la PAGE DÉTAIL
 * (`/intervenants/[id]`), passer l'id cible.
 *
 * Règles (option C transitoire — Vincent 2026-05-21) :
 *   - Feature désactivée (kill switch ENV) → refus net (disabled)
 *   - Pas authentifié → refus net (unauthenticated)
 *   - viewer.id === targetUserId → ✅ (self, doctrine V6.2 OK)
 *   - viewer.role ∈ {admin, manager} → ✅ + audit log obligatoire côté caller
 *   - chef_equipe sur autre que self → ❌ (forbidden — exclu doctrine option C)
 */
export async function checkIntervenantsPageAccess(
  targetUserId: string | null,
): Promise<IntervenantsPageAccessResult> {
  if (!isIntervenantsPageEnabled()) {
    return { allowed: false, reason: 'disabled' }
  }
  const viewer = await getCurrentUserWithProfile()
  if (!viewer) return { allowed: false, reason: 'unauthenticated' }

  const isSelf = targetUserId !== null && viewer.id === targetUserId
  const isPrivileged = PRIVILEGED_ROLES.includes(viewer.role)

  if (!isSelf && !isPrivileged) {
    return { allowed: false, reason: 'forbidden' }
  }
  if (!isSelf && isPrivileged && targetUserId !== null) {
    const inScope = await canViewerAccessIntervenantInScope({
      viewerId: viewer.id,
      viewerEmail: viewer.email,
      targetUserId,
    })
    if (!inScope) return { allowed: false, reason: 'forbidden' }
  }

  return { allowed: true, access: { viewer, isSelf, isPrivileged } }
}
