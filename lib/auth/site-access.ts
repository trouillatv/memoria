import 'server-only'

// P0 — LA FRONTIÈRE D'ORGANISATION SUR L'ACCÈS DIRECT À UN CHANTIER.
//
// Fuite prouvée dynamiquement (docs/multi-organisations/M1-recette-cartographie)
// : un compte membre uniquement de SERVINOR ouvrait un chantier AGP par URL et
// en voyait le contenu. `getSiteIdentity` — la primitive de lecture
// transversale du chantier, 40 appelants — ne vérifiait AUCUNE appartenance.
//
// Ce n'est pas un défaut de M1 : la page n'a jamais été gardée. C'est une
// frontière de sécurité déjà franchissable, indépendante du multi-organisations
// — le compte multi-org n'a fait que la rendre démontrable.
//
// ── CE QUE CE HELPER FAIT, ET CE QU'IL NE FAIT PAS ─────────────────────────
//
// Il répond à UNE question : l'utilisateur courant est-il membre actif de
// l'organisation PROPRIÉTAIRE de ce chantier ? Il ne rattache aucune table
// enfant, ne réécrit aucun `getOrgId()`, n'agrège rien. Le durcissement
// structurel (les 4 tables sans `organization_id`, la garde par objet enfant)
// reste le travail de M2.
//
// ── LE RÔLE PLATEFORME N'OUVRE PAS LES DONNÉES MÉTIER (Vincent, 2026-07-22) ─
//
// Version précédente : `if (user.role === 'admin') return true`. Elle
// transformait l'administration TECHNIQUE de MemorIA en accès UNIVERSEL aux
// données de toutes les entreprises clientes. C'est la faute que ce prolongement
// P0 corrige, et elle est plus profonde que la fuite initiale :
//
//   · pouvoir PLATEFORME (`users.role === 'admin'`) → administrer MemorIA
//     (la console `/admin/*`). Ce pouvoir NE donne AUCUN accès métier.
//   · accès MÉTIER à un chantier → appartenance active à SON organisation,
//     TOUJOURS, y compris pour un super-admin plateforme.
//
// Conséquence voulue : pour déboguer comme Guillaume, un administrateur doit
// avoir les MÊMES appartenances que lui — pas contourner la frontière par son
// rôle. Son compte est puissant parce qu'il CUMULE (admin plateforme + ses
// memberships), jamais parce que le rôle ignore la frontière.
//
// Un mode support explicite (organisation choisie, journalisé, borné dans le
// temps) reste possible plus tard — mais séparé, visible, et ce n'est pas ici.
//
// ── POURQUOI PAS `requireOwned` DIRECTEMENT ────────────────────────────────
//
// `requireOwned` compare l'org de l'objet à `getOrgId()` — l'organisation
// UNIQUE du caller — et exempte `role === 'admin'`. Deux raisons de ne pas s'en
// servir ici : (1) `getOrgId()` LÈVE en multi-org (M1) ; (2) son exemption
// admin est justement ce qu'on refuse. On vérifie donc l'APPARTENANCE à l'org
// du site — vraie pour mono comme pour multi, sans exemption de rôle. M2/M8
// réexamineront l'exemption admin transversale de `requireOwned`, qui sert
// encore d'autres surfaces (clients, contrats, planning…).
//
// ── LE REFUS NE RÉVÈLE RIEN ────────────────────────────────────────────────
//
// `userCanAccessSite` rend un booléen ; l'appelant traduit un refus en `null`
// (donc `notFound()` chez les pages) — jamais un message distinct « pas
// membre » vs « chantier inconnu ». Confirmer l'existence, l'organisation ou le
// nom d'un chantier d'une autre entreprise serait déjà une fuite.

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'

/**
 * L'utilisateur courant peut-il lire ce chantier ?
 *
 * Charge la SEULE information nécessaire à la décision — l'organisation
 * propriétaire — avant toute lecture métier. Fail-closed : la moindre
 * incertitude (session absente, lecture en échec) rend `false`.
 *
 * Un chantier sans `organization_id` ne peut pas fuiter ENTRE organisations :
 * il n'appartient à aucune. On ne lui applique donc pas de nouvelle
 * restriction — le P0 ferme la frontière inter-organisations, il n'invente pas
 * d'autres refus. (Mesuré : 0 chantier sans organisation aujourd'hui.)
 */
/**
 * L'utilisateur courant est-il membre de l'organisation propriétaire de CETTE
 * ligne (`table`.`id`) ? Généralise la frontière du chantier aux autres objets
 * accédés par ID depuis une URL (clients, interventions, missions, contrats…).
 *
 * MÊME DOCTRINE, MÊME ABSENCE D'EXEMPTION : le rôle plateforme n'ouvre pas les
 * données métier. `table` est une liste fermée — on ne lit l'organisation que
 * de tables connues pour la porter.
 */
export async function userCanAccessOrgRow(
  table: 'clients' | 'interventions' | 'missions' | 'contracts',
  id: string,
): Promise<boolean> {
  if (!id) return false
  if (!(await getCurrentUserWithProfile())) return false

  // `interventions` ne porte pas toujours `organization_id` directement selon
  // les versions — on lit la colonne, `undefined` ⇒ ligne absente ⇒ refus.
  const { data, error } = await createAdminClient()
    .from(table)
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return false
  const orgId = (data as { organization_id: string | null }).organization_id ?? null
  if (!orgId) return true
  return (await requireOrganizationMembership(orgId)).ok
}

export async function userCanAccessSite(siteId: string): Promise<boolean> {
  if (!siteId) return false

  // Session obligatoire (fail-closed) — même pour un chantier sans org, plus bas.
  if (!(await getCurrentUserWithProfile())) return false

  // AUCUNE EXEMPTION DE RÔLE ICI. Ni `users.role === 'admin'` (plateforme), ni
  // un rôle d'appartenance. L'accès à un chantier passe TOUJOURS par
  // l'appartenance à son organisation. Un administrateur plateforme sans
  // membership de l'org du chantier reçoit le même refus que n'importe qui.

  const { data, error } = await createAdminClient()
    .from('sites')
    .select('organization_id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  // Chantier introuvable : ce n'est pas à ce helper de le dire — l'appelant
  // rendra `notFound` de toute façon. On n'ouvre pas l'accès pour autant.
  if (error) return false
  const orgId = (data as { organization_id: string | null } | null)?.organization_id ?? null
  if (!orgId) return true
  const res = await requireOrganizationMembership(orgId)
  return res.ok
}
