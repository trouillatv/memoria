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
// ── EXEMPTION SUPER-ADMIN : ON SUIT LA DOCTRINE CENTRALE DU DÉPÔT ───────────
//
// `lib/auth/ownership.ts` (`decideOwnership`), utilisé par la garde mobile
// `requireSiteAccess`, laisse passer `role === 'admin'` SANS lire l'objet : le
// super-admin plateforme n'est scopé à aucune organisation. C'est la doctrine
// réelle et centrale du dépôt — on l'épouse plutôt que d'en inventer une
// deuxième. (Le garde du CR de visite ne l'exempte pas, mais c'est un cas
// isolé, pas la primitive d'ownership.)
//
// ── POURQUOI PAS `requireOwned` DIRECTEMENT ────────────────────────────────
//
// `requireOwned` compare l'org de l'objet à `getOrgId()` — l'organisation
// UNIQUE du caller. Pour un compte multi-organisations, `getOrgId()` LÈVE
// (M1) : le mobile héritera de ce comportement en M2. Mais le P0 doit
// permettre au compte multi-org d'ouvrir SES chantiers (AGP et SERVINOR) sans
// lever. On vérifie donc l'APPARTENANCE à l'org du site — vrai pour mono comme
// pour multi — au lieu de l'égalité à une org unique. C'est la version
// multi-org-ready de la même frontière ; M2 unifiera les deux gardes.
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
export async function userCanAccessSite(siteId: string): Promise<boolean> {
  if (!siteId) return false

  // Super-admin plateforme : passe sans lire l'objet (doctrine `decideOwnership`).
  const user = await getCurrentUserWithProfile()
  if (!user) return false
  if (user.role === 'admin') return true

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
