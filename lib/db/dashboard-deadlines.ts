import { createAdminClient } from '@/lib/supabase/admin'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'

export type DashboardDeadlineToPlan = {
  id: string
  organizationId: string
  organization: OrganizationIdentity
  siteId: string
  siteName: string
  clientName: string | null
  title: string
  constraintText: string | null
  reportId: string | null
  href: string
}

/** Échéances confirmées mais sans date : elles attendent un choix humain. */
export async function getDashboardDeadlinesToPlan(
  orgIds: string[],
  organizationMap: OrganizationIdentityMap = {},
): Promise<DashboardDeadlineToPlan[]> {
  if (orgIds.length === 0) return []
  const db = createAdminClient()
  const { data: rows, error } = await db
    .from('site_deadlines')
    .select('id, site_id, title, constraint_text, report_id, sites!inner(name, client_id, organization_id)')
    .eq('status', 'to_plan')
    .is('deleted_at', null)
    .in('sites.organization_id', orgIds)
    .order('created_at', { ascending: true })
    .limit(30)
  if (error) return []

  const raw = (rows ?? []) as Array<{
    id: string
    site_id: string
    title: string
    constraint_text: string | null
    report_id: string | null
    sites: { name: string; client_id: string | null; organization_id: string } | Array<{ name: string; client_id: string | null; organization_id: string }>
  }>
  const siteOf = (row: (typeof raw)[number]) => Array.isArray(row.sites) ? row.sites[0] : row.sites
  const clientIds = [...new Set(raw.map((row) => siteOf(row)?.client_id).filter((id): id is string => !!id))]
  const clientNames = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clients } = await db.from('clients').select('id, name').in('id', clientIds)
    for (const client of (clients ?? []) as Array<{ id: string; name: string }>) clientNames.set(client.id, client.name)
  }

  return raw.map((row) => {
    const site = siteOf(row)
    if (!site) return null
    return ({
    id: row.id,
    organizationId: site.organization_id,
    organization: organizationMap[site.organization_id] ?? {
      id: site.organization_id,
      name: site.organization_id,
      slug: site.organization_id,
      logoPath: null,
      logoUrl: null,
      brandColor: null,
    },
    siteId: row.site_id,
    siteName: site.name,
    clientName: site.client_id ? (clientNames.get(site.client_id) ?? null) : null,
    title: row.title,
    constraintText: row.constraint_text,
    reportId: row.report_id,
    href: `/semaine?site=${encodeURIComponent(row.site_id)}`,
    })
  }).filter((row): row is DashboardDeadlineToPlan => row !== null)
}
