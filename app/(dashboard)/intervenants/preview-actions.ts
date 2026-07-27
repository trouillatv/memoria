'use server'

// Aperçu vivant du panneau maître-détail (refonte UI 2026-07-27). Charge la fiche de
// l'acteur sélectionné À LA DEMANDE, avec la MÊME garde d'accès que la page (kill-switch
// + privilégié) et le MÊME org-scope. Le client ne peut pas demander un acteur hors périmètre.

import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getPersonFiche } from '@/lib/db/person-fiche'
import { getCompanyFiche } from '@/lib/db/company-fiche'
import { getTeamActorInsight } from '@/lib/db/team-actor-insight'
import type { ActorPreview } from './preview-types'

export async function loadActorPreview(kind: 'person' | 'company' | 'team', id: string): Promise<ActorPreview> {
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed || !access.access.isPrivileged) return null
  const orgIds = await getOrgIdsOfUser()

  if (kind === 'person') {
    const fiche = await getPersonFiche(id, orgIds)
    return fiche ? { kind, fiche } : null
  }
  if (kind === 'company') {
    const fiche = await getCompanyFiche(id, orgIds)
    return fiche ? { kind, fiche } : null
  }
  const insight = await getTeamActorInsight(id, orgIds)
  return insight ? { kind: 'team', insight } : null
}
