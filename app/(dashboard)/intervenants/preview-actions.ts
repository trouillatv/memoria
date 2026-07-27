'use server'

// Aperçu vivant du panneau maître-détail (refonte UI 2026-07-27). Charge la fiche de
// l'acteur sélectionné À LA DEMANDE, avec la MÊME garde d'accès que la page (kill-switch
// + privilégié) et le MÊME org-scope. Le client ne peut pas demander un acteur hors périmètre.

import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getPersonFiche } from '@/lib/db/person-fiche'
import { getCompanyFiche } from '@/lib/db/company-fiche'
import { getTeamActorInsight } from '@/lib/db/team-actor-insight'
import { getActorNetwork } from '@/lib/knowledge/actors-graph'
import type { ActorPreview } from './preview-types'

const PREFIX = { person: 'p_', company: 'co_', team: 'tm_' } as const

export async function loadActorPreview(kind: 'person' | 'company' | 'team', id: string): Promise<ActorPreview> {
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed || !access.access.isPrivileged) return null
  const orgIds = await getOrgIdsOfUser()
  // La fiche complète ET son réseau (ego-graph centré) — affichés directement dans la fiche.
  const networkP = getActorNetwork(`${PREFIX[kind]}${id}`, orgIds)

  if (kind === 'person') {
    const [fiche, network] = await Promise.all([getPersonFiche(id, orgIds), networkP])
    return fiche ? { kind, fiche, network } : null
  }
  if (kind === 'company') {
    const [fiche, network] = await Promise.all([getCompanyFiche(id, orgIds), networkP])
    return fiche ? { kind, fiche, network } : null
  }
  const [insight, network] = await Promise.all([getTeamActorInsight(id, orgIds), networkP])
  return insight ? { kind: 'team', insight, network } : null
}
