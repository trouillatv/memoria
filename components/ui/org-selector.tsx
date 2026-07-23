import 'server-only'

// Sélecteur d'organisation — Server Component.
// Mono-org : hidden input silencieux. Multi-org : <select> obligatoire.
// Pour les Client Components, utiliser OrgSelectorClient en passant les orgs
// depuis le parent Server Component via getOrgsForSelector().

import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrganizationLabels } from '@/lib/db/organisations'
import { OrgSelectorClient, type OrgOption } from './org-selector-client'

export type { OrgOption }

interface OrgSelectorProps {
  name?: string
  defaultValue?: string
  className?: string
}

/** Charge les orgs de l'utilisateur courant pour les passer à OrgSelectorClient. */
export async function getOrgsForSelector(): Promise<OrgOption[]> {
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []
  const labels = await getOrganizationLabels(orgIds)
  return orgIds.map((id) => ({ id, label: labels[id] ?? id }))
}

/** Server Component — utilisable UNIQUEMENT dans un Server Component. */
export async function OrgSelector({
  name = 'organization_id',
  defaultValue,
  className,
}: OrgSelectorProps) {
  const orgs = await getOrgsForSelector()
  if (orgs.length === 0) return null
  if (orgs.length === 1) {
    return <input type="hidden" name={name} value={orgs[0].id} />
  }
  return (
    <OrgSelectorClient
      name={name}
      orgs={orgs}
      defaultValue={defaultValue}
      className={className}
    />
  )
}
