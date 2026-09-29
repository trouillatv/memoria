import { createAdminClient } from '@/lib/supabase/admin'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'
import { getDeletedDocumentIds } from '@/lib/documents/historical-source-eligibility'

export type SiteStatus = 'critical' | 'warning' | 'normal'

export type SiteDashboardItem = {
  id: string
  name: string
  organizationId: string
  organization: OrganizationIdentity
  clientName: string | null
  activeActionCount: number
  overdueActionCount: number
  openReserveCount: number
  lastActivityAt: string | null
  nextPassageAt: string | null
  status: SiteStatus
  href: string
  /** Nombre de PV matérialisés éligibles (mêmes règles que canonicalRunsForSite : run
   *  matérialisé via site_reports.extraction_run_id, source document non supprimé). */
  pvCount: number
  /** Sujets suivis — proxy léger de matrix.rows.length (Historique) : nombre de
   *  canonical_subject_id distincts liés au chantier via subject_thread_identity. */
  subjectCount: number
}

/**
 * Sécurité (Home V2, Correction B) — valide `siteId` contre TOUS les chantiers
 * réellement accessibles à l'utilisateur (site.organization_id ∈ orgIds), jamais
 * seulement le sous-ensemble affiché (top 3/5). À appeler AVANT tout calcul lourd :
 * un id hors périmètre ne doit produire ni nom, ni compteur, ni logo, ni délai de
 * réponse distinct — l'appelant se replie silencieusement sur le chantier par défaut.
 */
export async function isSiteAccessible(siteId: string, orgIds: string[]): Promise<boolean> {
  if (!siteId || orgIds.length === 0) return false
  const { data } = await createAdminClient()
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .in('organization_id', orgIds)
    .is('deleted_at', null)
    .maybeSingle()
  return !!data
}

/**
 * Batch, pour TOUS les siteIds fournis, le nombre de PV matérialisés éligibles et le
 * nombre de sujets suivis — mêmes règles que getMaterializedRunIdsForSite et
 * matrix.rows.length, mais en UNE lecture groupée (jamais une requête par site).
 */
async function getPvAndSubjectCounts(
  supabase: ReturnType<typeof createAdminClient>,
  siteIds: string[],
): Promise<{ pvCounts: Map<string, number>; subjectCounts: Map<string, number> }> {
  const [{ data: reportRows }, { data: threadRows }] = await Promise.all([
    supabase
      .from('site_reports')
      .select('site_id, extraction_run_id, source_document_id')
      .in('site_id', siteIds)
      .not('extraction_run_id', 'is', null),
    supabase
      .from('subject_thread_identity')
      .select('site_id, canonical_subject_id')
      .in('site_id', siteIds),
  ])

  type ReportRow = { site_id: string; extraction_run_id: string; source_document_id: string | null }
  const reports = (reportRows ?? []) as ReportRow[]
  const deletedDocIds = await getDeletedDocumentIds(supabase, reports.map((r) => r.source_document_id))

  const runIdsBySite = new Map<string, Set<string>>()
  for (const r of reports) {
    if (r.source_document_id && deletedDocIds.has(r.source_document_id)) continue
    if (!runIdsBySite.has(r.site_id)) runIdsBySite.set(r.site_id, new Set())
    runIdsBySite.get(r.site_id)!.add(r.extraction_run_id)
  }
  const pvCounts = new Map<string, number>()
  for (const [siteId, runIds] of runIdsBySite) pvCounts.set(siteId, runIds.size)

  type ThreadRow = { site_id: string; canonical_subject_id: string }
  const subjectIdsBySite = new Map<string, Set<string>>()
  for (const t of (threadRows ?? []) as ThreadRow[]) {
    if (!subjectIdsBySite.has(t.site_id)) subjectIdsBySite.set(t.site_id, new Set())
    subjectIdsBySite.get(t.site_id)!.add(t.canonical_subject_id)
  }
  const subjectCounts = new Map<string, number>()
  for (const [siteId, ids] of subjectIdsBySite) subjectCounts.set(siteId, ids.size)

  return { pvCounts, subjectCounts }
}

export async function getSitesDashboard(
  orgIds: string[],
  organizationMap?: OrganizationIdentityMap,
  opts?: { limit?: number; ensureSiteId?: string | null },
): Promise<SiteDashboardItem[]> {
  if (orgIds.length === 0) return []
  const supabase = createAdminClient()
  const organizations = organizationMap ?? {}
  const organizationFor = (organizationId: string): OrganizationIdentity => organizations[organizationId] ?? {
    id: organizationId,
    name: organizationId,
    slug: organizationId,
    logoPath: null,
    logoUrl: null,
    brandColor: null,
  }

  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, name, organization_id, client_id')
    .in('organization_id', orgIds)
    .is('deleted_at', null)

  type SiteRow = { id: string; name: string; organization_id: string; client_id: string | null }
  const sites = (siteRows ?? []) as SiteRow[]
  if (sites.length === 0) return []

  const siteIds = sites.map((s) => s.id)

  const clientIds = [...new Set(sites.map((s) => s.client_id).filter((v): v is string => !!v))]
  const clientNames = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: cls } = await supabase.from('clients').select('id, name').in('id', clientIds)
    for (const cl of (cls ?? []) as Array<{ id: string; name: string }>) {
      clientNames.set(cl.id, cl.name)
    }
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea' }).format(now)

  const [actionRes, reserveRes, reportRes, pvAndSubjectCounts, eventRes] = await Promise.all([
    supabase
      .from('site_actions')
      .select('site_id, status, due_date')
      .in('site_id', siteIds)
      .in('status', ['open', 'planned']),
    supabase
      .from('site_reserve')
      .select('site_id')
      .in('site_id', siteIds)
      .eq('status', 'open'),
    supabase
      .from('site_reports')
      .select('site_id, ended_at, planned_at')
      .in('site_id', siteIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(siteIds.length * 10),
    getPvAndSubjectCounts(supabase, siteIds),
    supabase
      .from('site_scheduled_events')
      .select('site_id, planned_start')
      .in('site_id', siteIds)
      .gt('planned_start', new Date().toISOString())
      .order('planned_start', { ascending: true })
      .limit(siteIds.length * 3),
  ])

  const activeCount = new Map<string, number>()
  const overdueCount = new Map<string, number>()
  for (const a of (actionRes.data ?? []) as Array<{
    site_id: string
    status: string
    due_date: string | null
  }>) {
    activeCount.set(a.site_id, (activeCount.get(a.site_id) ?? 0) + 1)
    if (a.due_date && a.due_date < today) {
      overdueCount.set(a.site_id, (overdueCount.get(a.site_id) ?? 0) + 1)
    }
  }

  const reserveCount = new Map<string, number>()
  for (const r of (reserveRes.data ?? []) as Array<{ site_id: string }>) {
    reserveCount.set(r.site_id, (reserveCount.get(r.site_id) ?? 0) + 1)
  }

  const nextPassage = new Map<string, string>()
  const lastActivity = new Map<string, string>()
  for (const r of (reportRes.data ?? []) as Array<{
    site_id: string
    ended_at: string | null
    planned_at: string | null
  }>) {
    if (r.ended_at) {
      const current = lastActivity.get(r.site_id)
      if (!current || r.ended_at > current) lastActivity.set(r.site_id, r.ended_at)
    }
    if (r.planned_at && r.planned_at > nowIso) {
      const current = nextPassage.get(r.site_id)
      if (!current || r.planned_at < current) nextPassage.set(r.site_id, r.planned_at)
    }
  }

  for (const e of (eventRes.data ?? []) as Array<{ site_id: string; planned_start: string }>) {
    const current = nextPassage.get(e.site_id)
    if (!current || e.planned_start < current) nextPassage.set(e.site_id, e.planned_start)
  }

  const items: SiteDashboardItem[] = sites.map((site) => {
    const active = activeCount.get(site.id) ?? 0
    const overdue = overdueCount.get(site.id) ?? 0
    const reserve = reserveCount.get(site.id) ?? 0
    const last = lastActivity.get(site.id) ?? null
    const next = nextPassage.get(site.id) ?? null
    // Catégorie d'affichage déterministe — pas un score métier ni une inférence IA.
    // Règle : overdue ou réserve ouverte → critical ; actions actives seules → warning.
    const status: SiteStatus = overdue > 0 || reserve > 0 ? 'critical' : active > 0 ? 'warning' : 'normal'

    return {
      id: site.id,
      name: site.name,
      organizationId: site.organization_id,
      organization: organizationFor(site.organization_id),
      clientName: site.client_id ? (clientNames.get(site.client_id) ?? null) : null,
      activeActionCount: active,
      overdueActionCount: overdue,
      openReserveCount: reserve,
      lastActivityAt: last,
      nextPassageAt: next,
      status,
      href: `/sites/${site.id}`,
      pvCount: pvAndSubjectCounts.pvCounts.get(site.id) ?? 0,
      subjectCount: pvAndSubjectCounts.subjectCounts.get(site.id) ?? 0,
    }
  })

  // overdueActionCount DESC → openReserveCount DESC → activeActionCount DESC →
  // nextPassageAt ASC NULLS LAST → lastActivityAt DESC NULLS LAST → name ASC
  items.sort((a, b) => {
    if (b.overdueActionCount !== a.overdueActionCount) return b.overdueActionCount - a.overdueActionCount
    if (b.openReserveCount !== a.openReserveCount) return b.openReserveCount - a.openReserveCount
    if (b.activeActionCount !== a.activeActionCount) return b.activeActionCount - a.activeActionCount
    if (a.nextPassageAt && !b.nextPassageAt) return -1
    if (!a.nextPassageAt && b.nextPassageAt) return 1
    if (a.nextPassageAt && b.nextPassageAt && a.nextPassageAt !== b.nextPassageAt) {
      return a.nextPassageAt < b.nextPassageAt ? -1 : 1
    }
    if (a.lastActivityAt && !b.lastActivityAt) return -1
    if (!a.lastActivityAt && b.lastActivityAt) return 1
    if (a.lastActivityAt && b.lastActivityAt && a.lastActivityAt !== b.lastActivityAt) {
      return a.lastActivityAt < b.lastActivityAt ? 1 : -1
    }
    return a.name.localeCompare(b.name, 'fr')
  })

  const limit = opts?.limit ?? 5
  let result = items.slice(0, limit)
  // L'actif doit toujours apparaître dans les cartes visibles — s'il n'est pas
  // déjà dans le top naturel, on le préfixe sans requête supplémentaire (le tri
  // complet est déjà en mémoire) et on tronque le reste pour garder `limit`.
  if (opts?.ensureSiteId && !result.some((it) => it.id === opts.ensureSiteId)) {
    const ensured = items.find((it) => it.id === opts.ensureSiteId)
    if (ensured) {
      result = [ensured, ...items.filter((it) => it.id !== opts.ensureSiteId).slice(0, limit - 1)]
    }
  }
  return result
}
