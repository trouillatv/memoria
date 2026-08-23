'use server'

// Les organisations dans lesquelles CE compte peut créer un chantier.
//
// Sert UNIQUEMENT à peupler le sélecteur « Société » du mini-formulaire de
// création à la volée (Visite, Réunion, partage WhatsApp). L'UI s'en sert pour
// décider s'il faut poser la question :
//   · longueur 1 → aucun sélecteur, l'organisation est évidente ;
//   · longueur > 1 → le champ « Société » apparaît.
//
// ⚠️ Ce n'est PAS une autorisation. Le serveur ne croit jamais ce que le
// sélecteur renvoie : `resolveCreationOrgId` revalide, puis `createSite`
// revérifie l'appartenance. Cette liste ne fait qu'éviter à l'humain de deviner.

import { requireFieldAgent } from '@/lib/field/auth'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationIdentityMap, type OrganizationIdentity } from '@/lib/db/organisations'

export interface CreatableOrgOption {
  id: string
  name: string
}

export async function listCreatableOrgsAction(): Promise<CreatableOrgOption[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []

  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []

  // Mono-org : l'UI n'affichera rien, inutile de payer la lecture d'identité.
  if (orgIds.length === 1) return [{ id: orgIds[0], name: '' }]

  // Une panne de lecture d'identité ne doit pas faire disparaître le choix :
  // sans sélecteur, le serveur refuserait la création. On dégrade les libellés,
  // jamais la question.
  const map: Record<string, OrganizationIdentity> = await getOrganizationIdentityMap(orgIds).catch(
    () => ({}) as Record<string, OrganizationIdentity>,
  )
  return orgIds
    .map((id) => ({ id, name: map[id]?.name ?? '' }))
    // Un nom vide serait un choix aveugle : on ne propose pas de trancher entre
    // deux lignes muettes. La ligne reste, l'identifiant sert de repli lisible.
    .map((o) => (o.name ? o : { ...o, name: o.id.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
