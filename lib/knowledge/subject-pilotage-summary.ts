import 'server-only'

// Sujet — bloc dérivé « À piloter » (mandat Vincent 2026-09-20, items 1+6 du lot Acteurs) :
// jamais un champ « Responsable du Sujet » — le Sujet est un thème durable, pas une tâche,
// et être cité dans son contenu n'implique aucune responsabilité. Ce module se contente
// d'AGRÉGER des faits déjà posés ailleurs (état des Points via loadTrackedPointReadModel,
// FK Responsable des Actions via site_actions, désignation Pilote via
// tracked_point_responsible_companies) : aucun nouveau moteur d'état, aucune déduction.

import { createAdminClient } from '@/lib/supabase/admin'
import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'
import { getActiveResponsibleCompanyDesignations } from '@/lib/db/tracked-point-responsible-companies'
import { resolveCanonicalCompanyIdById } from '@/lib/db/companies'
import type { SiteActionStatus } from '@/types/db'

export interface SubjectPilotageSummary {
  openPointsCount: number
  actionsCount: number
  actionsWithResponsibleCount: number
  actionsWithoutResponsibleCount: number
  // Renseigné seulement quand la situation est assez simple pour être nommée explicitement
  // (exactement 1 Point ouvert) — au-delà, nommer UN pilote ou UN responsable n'aurait plus
  // de sens et seuls les compteurs agrégés comptent.
  single: { pointPilotName: string | null; actionResponsibleName: string | null } | null
}

type ActionRow = {
  id: string
  status: SiteActionStatus
  assigned_to: string | null
  assigned_contact_id: string | null
  assigned_company_id: string | null
}

export async function loadSubjectPilotageSummary(points: PointReadModelEntry[]): Promise<SubjectPilotageSummary> {
  const openPoints = points.filter((p) => p.derivedState !== 'resolved')
  const openPointsCount = openPoints.length

  const cboIds = [...new Set(openPoints.flatMap((p) => p.cboIds))]
  let openActions: ActionRow[] = []
  if (cboIds.length > 0) {
    const db = createAdminClient()
    const { data: memberRows } = await db
      .from('canonical_business_object_member')
      .select('member_entity_id')
      .in('canonical_business_object_id', cboIds)
      .eq('member_entity_type', 'site_action')
    const actionIds = [...new Set((memberRows ?? []).map((r) => r.member_entity_id as string))]
    if (actionIds.length > 0) {
      const { data: actionRows } = await db
        .from('site_actions')
        .select('id, status, assigned_to, assigned_contact_id, assigned_company_id')
        .in('id', actionIds)
      openActions = ((actionRows ?? []) as ActionRow[]).filter((a) => a.status !== 'done' && a.status !== 'cancelled')
    }
  }

  const actionsCount = openActions.length
  const actionsWithResponsibleCount = openActions.filter((a) => a.assigned_contact_id || a.assigned_company_id || a.assigned_to).length

  let single: SubjectPilotageSummary['single'] = null
  if (openPointsCount === 1) {
    single = {
      pointPilotName: await getPointPilotName(openPoints[0].id),
      actionResponsibleName: actionsCount === 1 ? await resolveActionResponsibleName(openActions[0]) : null,
    }
  }

  return {
    openPointsCount,
    actionsCount,
    actionsWithResponsibleCount,
    actionsWithoutResponsibleCount: actionsCount - actionsWithResponsibleCount,
    single,
  }
}

async function getPointPilotName(pointId: string): Promise<string | null> {
  const designations = await getActiveResponsibleCompanyDesignations(pointId)
  return designations[0]?.companyName ?? null
}

async function resolveActionResponsibleName(a: ActionRow): Promise<string | null> {
  const db = createAdminClient()
  if (a.assigned_contact_id) {
    const { data } = await db.from('company_contacts').select('full_name').eq('id', a.assigned_contact_id).maybeSingle()
    if (data?.full_name) return data.full_name as string
  }
  if (a.assigned_company_id) {
    const canonicalId = await resolveCanonicalCompanyIdById(a.assigned_company_id)
    const { data } = await db.from('companies').select('name').eq('id', canonicalId).maybeSingle()
    if (data?.name) return data.name as string
  }
  if (a.assigned_to) return a.assigned_to
  return null
}
