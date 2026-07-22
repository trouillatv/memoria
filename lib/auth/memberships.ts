import 'server-only'

// M1 — APPARTENIR À PLUSIEURS ENTREPRISES AVEC UN SEUL COMPTE.
//
// AGP et SERVINOR sont deux entités juridiques distinctes. Guillaume travaille
// pour les deux, et doit garder un seul compte, un seul email, une seule
// session — avec un rôle propre à chacune.
//
// ── LES QUATRE NOTIONS QU'IL NE FAUT PAS CONFONDRE ─────────────────────────
//
//   · l'IDENTITÉ humaine     — Guillaume
//   · le COMPTE              — un seul `user_id`
//   · les APPARTENANCES      — membre d'AGP ET de SERVINOR
//   · la PROPRIÉTÉ métier    — chaque chantier appartient à UNE organisation
//
// Une vue multi-organisations sera une AGRÉGATION de données autorisées. Jamais
// une fusion de propriété, jamais un affaiblissement du cloisonnement.
//
// ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
//
// Il ne remplace pas `getOrgId()`, il ne rend aucune vue agrégée, il ne touche
// à aucune écriture métier. M1 est le socle d'appartenance, et rien d'autre.
//
// ── LA SÉCURITÉ NE VIENT PAS DE LA RLS ─────────────────────────────────────
//
// Le dépôt accède aux données par le service-role, qui CONTOURNE la RLS
// (cf. `docs/multi-organisations/M0-audit.md`). Le cloisonnement réel est
// applicatif. Chaque primitive d'accès ici vérifie donc explicitement, dans cet
// ordre : utilisateur authentifié → appartenance ACTIVE → organisation ciblée.
// Aucun raccourci, même quand le client est le service-role.

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import type { UserRole } from '@/types/db'
import { OrganisationAmbigueError } from '@/lib/auth/organisation-ambigue'

export { OrganisationAmbigueError }

export interface OrganizationMembership {
  organizationId: string
  role: UserRole
}

/**
 * Les appartenances ACTIVES de l'utilisateur courant.
 *
 * Une appartenance suspendue n'est pas rendue : elle garde l'historique, elle
 * ne donne aucun accès. Ne jamais filtrer le statut ailleurs qu'ici — un seul
 * endroit décide de ce que « membre » veut dire.
 */
export async function getOrganizationMembershipsOfUser(): Promise<OrganizationMembership[]> {
  const user = await getCurrentUserWithProfile()
  if (!user) return []
  const { data, error } = await createAdminClient()
    .from('organization_memberships')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
  // Fail-closed : une lecture en échec ne doit pas se traduire par « aucune
  // restriction », mais par « aucun accès ».
  if (error || !data) return []
  return (data as Array<{ organization_id: string; role: UserRole }>).map((r) => ({
    organizationId: r.organization_id,
    role: r.role,
  }))
}

/**
 * Les organisations accessibles — POUR LES LECTURES AGRÉGÉES À VENIR (M3).
 *
 * ⚠️ Ne JAMAIS s'en servir pour une écriture. Une écriture appartient à une
 * organisation et une seule : celle de l'objet qu'elle touche, pas « l'une de
 * celles auxquelles l'auteur a droit ». Utiliser cette liste pour écrire
 * reviendrait à laisser l'auteur choisir le propriétaire de la donnée.
 */
export async function getOrgIdsOfUser(): Promise<string[]> {
  return (await getOrganizationMembershipsOfUser()).map((m) => m.organizationId)
}

/** Ce que rend une vérification d'appartenance réussie. */
export interface MembershipContext {
  userId: string
  organizationId: string
  role: UserRole
}

/**
 * Refus UNIFORME. Le message ne dit jamais si l'organisation existe, si elle
 * est vide, ou si l'appartenance a été suspendue : trois messages distincts
 * permettraient d'énumérer les organisations d'un concurrent en observant
 * laquelle répond différemment.
 */
export const ACCES_REFUSE = 'Accès refusé' as const

export type MembershipResult =
  | { ok: true; context: MembershipContext }
  | { ok: false; error: typeof ACCES_REFUSE }

/**
 * L'utilisateur courant est-il membre ACTIF de cette organisation ?
 *
 * Rend son rôle DANS cette organisation — jamais le rôle global du profil, qui
 * ne veut plus rien dire dès qu'on appartient à deux entreprises.
 */
export async function requireOrganizationMembership(
  organizationId: string,
): Promise<MembershipResult> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: ACCES_REFUSE }
  // On ne fait PAS confiance au client sur l'organisation : on relit
  // l'appartenance en base, pour ce couple précis.
  const { data, error } = await createAdminClient()
    .from('organization_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) return { ok: false, error: ACCES_REFUSE }
  return {
    ok: true,
    context: { userId: user.id, organizationId, role: (data as { role: UserRole }).role },
  }
}

/**
 * Membre ACTIF **et** porteur d'un des rôles attendus, dans CETTE organisation.
 *
 * Le même refus que l'absence d'appartenance : distinguer « pas membre » de
 * « membre sans le droit » dirait à un tiers que l'organisation existe et qu'il
 * en fait partie.
 */
export async function requireOrganizationRole(
  organizationId: string,
  allowedRoles: readonly UserRole[],
): Promise<MembershipResult> {
  const res = await requireOrganizationMembership(organizationId)
  if (!res.ok) return res
  if (!allowedRoles.includes(res.context.role)) return { ok: false, error: ACCES_REFUSE }
  return res
}

/**
 * ── POURQUOI `getOrgId()` DOIT ÉCHOUER, ET NE PAS CHOISIR ──────────────────
 *
 * `getOrgId()` (`lib/db/users.ts`) rend `users.organization_id` : une valeur
 * scalaire, lue par 193 appels dont beaucoup sont des ÉCRITURES. Pour un
 * utilisateur multi-organisations, cette colonne n'est plus qu'une organisation
 * PAR DÉFAUT — elle ne fait plus autorité.
 *
 * La rendre quand même serait le pire des comportements : le vieux code
 * écrirait dans AGP une donnée saisie pour SERVINOR, sans erreur, sans trace,
 * et personne ne s'en apercevrait avant l'audit.
 *
 * D'où cet appel, branché DANS `getOrgId()` : au-delà d'une appartenance
 * active, on lève. L'erreur est le signal — elle désigne exactement les
 * endroits que M2 et M3 devront contextualiser.
 *
 * Aucun utilisateur n'a plus d'une appartenance aujourd'hui : le comportement
 * est donc rigoureusement inchangé tant que personne n'est ajouté à une
 * seconde entreprise.
 */
/**
 * L'organisation UNIQUE de l'utilisateur, ou une erreur — jamais un choix.
 *
 * Rend `null` quand il n'y a aucune appartenance (l'appelant reste fail-closed
 * comme avant), et LÈVE quand il y en a plusieurs.
 */
export async function getSoleOrgIdOrThrow(): Promise<string | null> {
  const ids = await getOrgIdsOfUser()
  if (ids.length > 1) throw new OrganisationAmbigueError(ids)
  return ids[0] ?? null
}
