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

export interface CompanyPilotedPointRow {
  id: string
  label: string
  siteId: string
  siteName: string
  designatedAt: string
  href: string // /sites/{siteId}/point/{id}
}

/** Points pilotés, cross-site, pour un ensemble d'entreprises (canonique + alias) — mandat
 *  Vincent 2026-09-16 (Mode Focus). Même table que `getActiveResponsibleCompanyDesignations`,
 *  interrogée en sens inverse (par `company_id` au lieu de `tracked_point_id`) ; modèle sur la
 *  requête site-scopée de `site-intervenants-consolidated.ts`. */
export async function getPilotedPointsByCompanies(
  companyIds: string[],
  orgIds: string[],
): Promise<CompanyPilotedPointRow[]> {
  if (companyIds.length === 0 || orgIds.length === 0) return []
  const db = createAdminClient()
  const { data, error } = await db
    .from('tracked_point_responsible_companies')
    .select('company_id, designated_at, tracked_point_id, site_id')
    .in('company_id', companyIds)
    .in('organization_id', orgIds)
    .is('revoked_at', null)
  if (error) throw error
  type Row = { company_id: string; designated_at: string; tracked_point_id: string; site_id: string }
  const designations = (data ?? []) as Row[]
  if (designations.length === 0) return []

  const pointIds = [...new Set(designations.map((d) => d.tracked_point_id))]
  const siteIds = [...new Set(designations.map((d) => d.site_id))]
  const [{ data: pointRows }, { data: siteRows }] = await Promise.all([
    db.from('tracked_point').select('id, label').in('id', pointIds),
    db.from('sites').select('id, name').in('id', siteIds),
  ])
  const labelById = new Map(((pointRows ?? []) as Array<{ id: string; label: string }>).map((p) => [p.id, p.label]))
  const siteNameById = new Map(((siteRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))

  return designations
    .map((d) => ({
      id: d.tracked_point_id,
      label: labelById.get(d.tracked_point_id) ?? '(Point)',
      siteId: d.site_id,
      siteName: siteNameById.get(d.site_id) ?? 'Chantier',
      designatedAt: d.designated_at,
      href: `/sites/${d.site_id}/point/${d.tracked_point_id}`,
    }))
    .sort((a, b) => b.designatedAt.localeCompare(a.designatedAt))
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
