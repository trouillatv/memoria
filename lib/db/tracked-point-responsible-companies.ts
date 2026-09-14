import 'server-only'

// Lot Entreprise citée → Responsable (mandat Vincent 2026-09-14, cas Clim Exp'Air, migration
// 406) : promotion humaine explicite d'une entreprise CITÉE (détectée dans le titre ou les
// preuves d'un Point) en responsable structuré de ce Point. La détection textuelle
// (computeCitedCompanies) ne crée JAMAIS cette ligne — seul le clic « Définir comme
// responsable » écrit ici. Réversible par retrait symétrique (revokeResponsibleCompany),
// jamais une suppression : `revoked_at` garde la trace de la décision passée.
//
// L'index unique de la migration 406 est PARTIEL (tracked_point_id, company_id) WHERE
// revoked_at IS NULL — à la différence de tracked_point_reviews (405, index plein), cette
// table n'est donc jamais consommée via `.upsert()`/`onConflict` : designate fait un
// check-then-insert explicite, revoke un UPDATE conditionnel, tous deux avec re-lecture en
// cas de course perdue plutôt que de deviner l'issue (même doctrine que
// tracked-point-pending-resolution.ts).

import { createAdminClient } from '@/lib/supabase/admin'

export interface ResponsibleCompanyDesignation {
  id: string
  companyId: string
  companyName: string
  designatedAt: string
}

async function getSiteOrganizationId(siteId: string): Promise<string | null> {
  const db = createAdminClient()
  const { data } = await db.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  return (data?.organization_id as string | undefined) ?? null
}

/** Désignations ACTIVES (revoked_at null) pour un Point donné — jamais celles retirées. */
export async function getActiveResponsibleCompanyDesignations(
  trackedPointId: string,
): Promise<ResponsibleCompanyDesignation[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_responsible_companies')
    .select('id, company_id, designated_at, companies(name)')
    .eq('tracked_point_id', trackedPointId)
    .is('revoked_at', null)
  if (error) throw error
  type Row = { id: string; company_id: string; designated_at: string; companies: { name: string } | { name: string }[] | null }
  return ((data ?? []) as Row[]).map((r) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies
    return { id: r.id, companyId: r.company_id, companyName: company?.name ?? '—', designatedAt: r.designated_at }
  })
}

export type DesignateResponsibleCompanyResult =
  | { ok: true; designationId: string; alreadyActive: boolean }
  | { ok: false; error: string }

export async function designateResponsibleCompany(params: {
  siteId: string
  trackedPointId: string
  companyId: string
  designatedBy: string
}): Promise<DesignateResponsibleCompanyResult> {
  const { siteId, trackedPointId, companyId, designatedBy } = params
  const db = createAdminClient()

  const organizationId = await getSiteOrganizationId(siteId)
  if (!organizationId) return { ok: false, error: 'SITE_NOT_FOUND' }

  const { data: point } = await db.from('tracked_point').select('id, site_id').eq('id', trackedPointId).maybeSingle()
  if (!point) return { ok: false, error: 'POINT_NOT_FOUND' }
  if (point.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }

  const { data: company } = await db.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!company) return { ok: false, error: 'COMPANY_NOT_FOUND' }

  const { data: existing } = await db
    .from('tracked_point_responsible_companies')
    .select('id')
    .eq('tracked_point_id', trackedPointId)
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .maybeSingle()
  if (existing) return { ok: true, designationId: existing.id, alreadyActive: true }

  const { data: inserted, error } = await db
    .from('tracked_point_responsible_companies')
    .insert({
      organization_id: organizationId,
      site_id: siteId,
      tracked_point_id: trackedPointId,
      company_id: companyId,
      designated_by: designatedBy,
    })
    .select('id')
    .single()
  if (error) {
    // Course concurrente sur l'index unique partiel : ne jamais deviner, relire l'état réel.
    const { data: raceExisting } = await db
      .from('tracked_point_responsible_companies')
      .select('id')
      .eq('tracked_point_id', trackedPointId)
      .eq('company_id', companyId)
      .is('revoked_at', null)
      .maybeSingle()
    if (raceExisting) return { ok: true, designationId: raceExisting.id, alreadyActive: true }
    throw error
  }
  return { ok: true, designationId: inserted.id, alreadyActive: false }
}

export type RevokeResponsibleCompanyResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; error: string }

export async function revokeResponsibleCompany(params: {
  siteId: string
  designationId: string
  revokedBy: string
}): Promise<RevokeResponsibleCompanyResult> {
  const { siteId, designationId, revokedBy } = params
  const db = createAdminClient()

  const { data: row } = await db
    .from('tracked_point_responsible_companies')
    .select('id, site_id, revoked_at')
    .eq('id', designationId)
    .maybeSingle()
  if (!row) return { ok: false, error: 'DESIGNATION_NOT_FOUND' }
  if (row.site_id !== siteId) return { ok: false, error: 'SITE_MISMATCH' }
  if (row.revoked_at) return { ok: true, alreadyRevoked: true }

  const { data: updated, error } = await db
    .from('tracked_point_responsible_companies')
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq('id', designationId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (updated) return { ok: true, alreadyRevoked: false }

  // Course perdue entre le SELECT et l'UPDATE gardé : relire l'état réel plutôt que deviner.
  const { data: afterRace } = await db
    .from('tracked_point_responsible_companies')
    .select('revoked_at')
    .eq('id', designationId)
    .single()
  return { ok: true, alreadyRevoked: !!afterRace?.revoked_at }
}
