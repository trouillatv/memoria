import 'server-only'

// M2C — LA FRONTIÈRE D'ÉCRITURE DU DOMAINE CHANTIER.
//
// M2B a donné UNE frontière de LECTURE : l'org vient de la ressource, membership
// actif, aucune exemption de rôle. M2C applique la même règle aux ÉCRITURES, en
// y ajoutant la seule chose qui manque à la lecture : la POLITIQUE DE RÔLE.
//
//     ressource (siteId / actionId)
//        ↓  résolution serveur de l'organisation PROPRIÉTAIRE (M2A / M2B)
//        ↓  membership actif à CETTE organisation
//        ↓  politique write existante (rôle DANS l'organisation)
//        ↓  mutation
//
// ── POURQUOI UNE PRIMITIVE, ET PAS UN SELECT PAR ACTION ────────────────────
//
// Cinq gestes touchent une action, trois touchent un site. Dupliquer la
// résolution d'org + la lecture des memberships dans chacun, c'est cinq endroits
// où l'un peut diverger. Ici, les server actions ne connaissent NI le SQL, NI la
// table `organization_memberships` : elles demandent un droit d'écrire, on le
// leur accorde ou non.
//
// ── LE RÔLE VIENT DE L'ORGANISATION, PAS DU PROFIL ─────────────────────────
//
// La politique de rôle est celle d'avant (mêmes ensembles que `requireOperator`
// / `requireManagerOrAdmin`) — AUCUNE nouvelle permission. Seule la SOURCE du
// rôle change : le rôle DANS l'organisation de la ressource (doctrine M1), pas
// `users.role` (l'org par défaut du profil, qui ne veut plus rien dire dès qu'un
// compte appartient à deux entreprises). Pour tout compte mono-org d'aujourd'hui,
// les deux coïncident : comportement inchangé.

import { resolveResourceAccess, type OrganizationMembershipRole } from '@/lib/auth/resource-access'
import type { UserRole } from '@/types/db'

/**
 * Les DEUX politiques de rôle déjà en vigueur dans le domaine chantier, nommées.
 * Ce ne sont pas de nouveaux droits : `operator` = l'ensemble de `requireOperator`,
 * `managerOrAdmin` = celui de `requireManagerOrAdmin`.
 */
export const WRITE_POLICIES = {
  operator: ['admin', 'manager', 'chef_equipe'],
  managerOrAdmin: ['admin', 'manager'],
} as const satisfies Record<string, readonly UserRole[]>

export type WritePolicy = keyof typeof WRITE_POLICIES

/** Ce qu'un droit d'écriture accordé donne à l'appelant : l'org (autoritaire,
 *  pour poser `organization_id` / valider une ressource liée), l'auteur (pour
 *  `created_by` / `actor`), et son rôle dans l'organisation. */
export type SiteWriteAccess =
  | { ok: true; organizationId: string; userId: string; role: OrganizationMembershipRole }
  | { ok: false; error: string }

/**
 * Refus UNIFORME, comme la frontière de lecture. Ni « n'existe pas » ni « pas le
 * droit » : un message unique, aucun oracle sur l'existence d'une ressource
 * étrangère.
 */
const REFUS = 'Accès refusé' as const

async function decide(
  req: Parameters<typeof resolveResourceAccess>[0],
  policy: WritePolicy,
): Promise<SiteWriteAccess> {
  const r = await resolveResourceAccess(req)
  // `unauthenticated` inclus : dans une server action on ne redirige pas, on
  // refuse. Ressource absente, étrangère, membership suspendu → même refus.
  if (!r.ok) return { ok: false, error: REFUS }
  const allowed = WRITE_POLICIES[policy] as readonly UserRole[]
  if (!allowed.includes(r.context.membershipRole)) {
    return { ok: false, error: REFUS }
  }
  return { ok: true, organizationId: r.context.organizationId, userId: r.context.userId, role: r.context.membershipRole }
}

/**
 * Droit d'écrire SUR UN SITE (créer une action, rattacher un élément, planifier).
 * L'org vient du site, résolu côté serveur — jamais d'un identifiant client cru.
 */
export function requireSiteWriteAccess(siteId: string, policy: WritePolicy = 'operator'): Promise<SiteWriteAccess> {
  return decide({ kind: 'site', id: siteId }, policy)
}

/**
 * Droit d'écrire SUR UNE ACTION (avancer, reporter, clôturer, rouvrir, annuler).
 * La racine est l'action elle-même : son `organization_id` (M2A) fait autorité,
 * le `site_id` que le client renvoie pour rafraîchir l'écran n'est jamais la
 * source de la frontière.
 */
export function requireSiteActionWriteAccess(actionId: string, policy: WritePolicy = 'operator'): Promise<SiteWriteAccess> {
  return decide({ kind: 'site_action', id: actionId }, policy)
}

/**
 * Droit d'écrire SUR UN COMPTE-RENDU (pièces, transcription, analyse, curation,
 * matérialisation…). L'org du CR est résolue depuis SA ligne — jamais depuis le
 * `tenant_id` legacy, ni depuis un `site_id` renvoyé par le client.
 */
export function requireSiteReportWriteAccess(reportId: string, policy: WritePolicy = 'operator'): Promise<SiteWriteAccess> {
  return decide({ kind: 'site_report', id: reportId }, policy)
}

/**
 * Droit d'écrire à propos d'un CONTRAT (ici : ouvrir un CR de réunion « contrat »).
 * La racine est le contrat ; son organisation est autoritaire (M2B).
 */
export function requireContractWriteAccess(contractId: string, policy: WritePolicy = 'operator'): Promise<SiteWriteAccess> {
  return decide({ kind: 'contract', id: contractId }, policy)
}
