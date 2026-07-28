import 'server-only'

// Fetcher des interactions élémentaires (V3 étape 2) : lit les 3 sources
// structurelles fiables (casting, appartenance d'équipe, action) SCOPÉES à
// l'organisation, puis délègue la composition PURE à buildActorInteractions.
//
// Isolation : tout est borné aux chantiers/équipes de l'org (fail-closed).
// Acteurs ARCHIVÉS : volontairement NON filtrés — une interaction historique reste
// vraie même si l'entreprise/personne a été archivée depuis (les libellés seront
// résolus plus tard, à l'affichage). Aucune pondération ici.

import { createAdminClient } from '@/lib/supabase/admin'
import { buildActorInteractions, type ActorInteraction } from '@/lib/knowledge/actor-interactions'

const day = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)

/** Toutes les interactions élémentaires de l'organisation (collection non pondérée).
 *  Fail-closed : sans org, aucune interaction. */
export async function getActorInteractions(orgIds: string[]): Promise<ActorInteraction[]> {
  if (orgIds.length === 0) return []
  const db = createAdminClient()

  const [siteRes, teamRes] = await Promise.all([
    db.from('sites').select('id').in('organization_id', orgIds).is('deleted_at', null),
    db.from('teams').select('id').in('organization_id', orgIds).is('deleted_at', null),
  ])
  const siteIds = ((siteRes.data ?? []) as Array<{ id: string }>).map((s) => s.id)
  const teamIds = ((teamRes.data ?? []) as Array<{ id: string }>).map((t) => t.id)

  const [castingRes, memberRes, actionRes] = await Promise.all([
    siteIds.length
      ? db.from('site_intervenants').select('site_id, company_id, effective_from, effective_to').in('site_id', siteIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? db.from('team_field_members').select('team_id, contact_id, joined_at, left_at').in('team_id', teamIds)
      : Promise.resolve({ data: [] }),
    siteIds.length
      ? db.from('site_actions').select('id, assigned_contact_id, assigned_company_id, created_at')
          .in('site_id', siteIds)
          .not('assigned_contact_id', 'is', null)
          .not('assigned_company_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  return buildActorInteractions({
    castings: ((castingRes.data ?? []) as Array<{ site_id: string; company_id: string; effective_from: string | null; effective_to: string | null }>)
      .map((r) => ({ siteId: r.site_id, companyId: r.company_id, from: day(r.effective_from), to: day(r.effective_to) })),
    teamMemberships: ((memberRes.data ?? []) as Array<{ team_id: string; contact_id: string; joined_at: string | null; left_at: string | null }>)
      .map((r) => ({ teamId: r.team_id, contactId: r.contact_id, from: day(r.joined_at), to: day(r.left_at) })),
    actions: ((actionRes.data ?? []) as Array<{ id: string; assigned_contact_id: string | null; assigned_company_id: string | null; created_at: string | null }>)
      .map((r) => ({ id: r.id, contactId: r.assigned_contact_id, companyId: r.assigned_company_id, occurredAt: day(r.created_at) })),
  })
}
