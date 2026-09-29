import { createAdminClient } from '@/lib/supabase/admin'
import type { OrganizationIdentity, OrganizationIdentityMap } from '@/lib/db/organisations'
import { getSignedLogoUrls } from '@/lib/storage/entity-logos'
import { getDeletedDocumentIds } from '@/lib/documents/historical-source-eligibility'

export type SiteStatus = 'critical' | 'warning' | 'normal'

/** Identité visuelle à afficher pour un chantier — le CLIENT (l'entreprise que
 *  le conducteur reconnaît, ex. "OCEF") prime sur l'organisation MemorIA
 *  propriétaire du chantier (ex. "BECIB") dès qu'un client est renseigné, même
 *  sans logo uploadé (le fallback initiales d'EntityLogo reste alors correct). */
export type DisplayIdentity = {
  label: string
  logoUrl: string | null
  brandColor: string | null
  source: 'client' | 'organization'
}

export type SiteDashboardItem = {
  id: string
  name: string
  organizationId: string
  organization: OrganizationIdentity
  clientName: string | null
  displayIdentity: DisplayIdentity
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
  /** Sujets suivis — reproduit exactement matrix.rows.length (getSiteSubjectMatrix) :
   *  threads distincts issus de document_extraction_proposal pour les runs éligibles du
   *  chantier, regroupés par canonical_subject_id quand lié (subject_thread_identity sans
   *  filtre site_id, comme le chemin canonique), sinon comptés un par un (ungrouped). */
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
 * getSiteSubjectMatrix (lib/documents/pv-history.ts), mais en lectures groupées
 * (jamais une requête par site).
 *
 * subjectCount reproduit exactement matrix.rows.length : threads distincts vus dans
 * document_extraction_proposal pour les runs éligibles du chantier, puis regroupés par
 * canonical_subject_id via subject_thread_identity (résolu par ID de thread, SANS filtre
 * site_id — le chemin canonique ne filtre jamais cette table par site) ; les threads sans
 * lien canonique restent comptés individuellement (ungrouped).
 */
async function getPvAndSubjectCounts(
  supabase: ReturnType<typeof createAdminClient>,
  siteIds: string[],
): Promise<{ pvCounts: Map<string, number>; subjectCounts: Map<string, number> }> {
  const { data: reportRows } = await supabase
    .from('site_reports')
    .select('site_id, extraction_run_id, source_document_id')
    .in('site_id', siteIds)
    .not('extraction_run_id', 'is', null)

  type ReportRow = { site_id: string; extraction_run_id: string; source_document_id: string | null }
  const reports = (reportRows ?? []) as ReportRow[]
  const deletedDocIds = await getDeletedDocumentIds(supabase, reports.map((r) => r.source_document_id))

  const runIdsBySite = new Map<string, Set<string>>()
  const siteIdByRunId = new Map<string, string>()
  for (const r of reports) {
    if (r.source_document_id && deletedDocIds.has(r.source_document_id)) continue
    if (!runIdsBySite.has(r.site_id)) runIdsBySite.set(r.site_id, new Set())
    runIdsBySite.get(r.site_id)!.add(r.extraction_run_id)
    siteIdByRunId.set(r.extraction_run_id, r.site_id)
  }
  const pvCounts = new Map<string, number>()
  for (const [siteId, runIds] of runIdsBySite) pvCounts.set(siteId, runIds.size)

  const allRunIds = [...siteIdByRunId.keys()]
  const subjectCounts = new Map<string, number>()
  if (allRunIds.length === 0) return { pvCounts, subjectCounts }

  type ProposalRow = { extraction_run_id: string; subject_thread_id: string }
  const { data: proposalRows } = await supabase
    .from('document_extraction_proposal')
    .select('extraction_run_id, subject_thread_id')
    .in('extraction_run_id', allRunIds)
    .not('subject_thread_id', 'is', null)

  const threadsBySite = new Map<string, Set<string>>()
  const allThreadIds = new Set<string>()
  for (const p of (proposalRows ?? []) as ProposalRow[]) {
    const siteId = siteIdByRunId.get(p.extraction_run_id)
    if (!siteId) continue
    if (!threadsBySite.has(siteId)) threadsBySite.set(siteId, new Set())
    threadsBySite.get(siteId)!.add(p.subject_thread_id)
    allThreadIds.add(p.subject_thread_id)
  }

  const canonicalByThread = new Map<string, string>()
  if (allThreadIds.size > 0) {
    type ThreadIdentityRow = { subject_thread_id: string; canonical_subject_id: string }
    const { data: stiRows } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', [...allThreadIds])
    for (const r of (stiRows ?? []) as ThreadIdentityRow[]) {
      canonicalByThread.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  for (const [siteId, threadIds] of threadsBySite) {
    const linkedCanonicalIds = new Set<string>()
    let ungroupedCount = 0
    for (const threadId of threadIds) {
      const canonicalId = canonicalByThread.get(threadId)
      if (canonicalId) linkedCanonicalIds.add(canonicalId)
      else ungroupedCount += 1
    }
    subjectCounts.set(siteId, linkedCanonicalIds.size + ungroupedCount)
  }

  return { pvCounts, subjectCounts }
}

export async function getSitesDashboard(
  orgIds: string[],
  organizationMap?: OrganizationIdentityMap,
  opts?: { limit?: number; ensureSiteId?: string | null; sortMode?: 'priority' | 'recent' },
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
  const clientLogoPaths = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: cls } = await supabase.from('clients').select('id, name, logo_path').in('id', clientIds)
    for (const cl of (cls ?? []) as Array<{ id: string; name: string; logo_path: string | null }>) {
      clientNames.set(cl.id, cl.name)
      if (cl.logo_path) clientLogoPaths.set(cl.id, cl.logo_path)
    }
  }
  const clientSignedUrls = await getSignedLogoUrls([...clientLogoPaths.values()])
  // Priorité identité : le CLIENT (entreprise que le conducteur reconnaît) dès
  // qu'il est renseigné, même sans logo — sinon l'organisation MemorIA.
  const displayIdentityFor = (site: SiteRow): DisplayIdentity => {
    const clientName = site.client_id ? clientNames.get(site.client_id) : undefined
    if (clientName) {
      const logoPath = clientLogoPaths.get(site.client_id!)
      return {
        label: clientName,
        logoUrl: logoPath ? (clientSignedUrls[logoPath] ?? null) : null,
        brandColor: null,
        source: 'client',
      }
    }
    const org = organizationFor(site.organization_id)
    return { label: org.name, logoUrl: org.logoUrl, brandColor: org.brandColor, source: 'organization' }
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
      displayIdentity: displayIdentityFor(site),
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

  if (opts?.sortMode === 'recent') {
    // Portefeuille "Vos chantiers" (RICHNESS §2) : récence réelle sur le portefeuille
    // COMPLET (avant tout limit/ensureSiteId), jamais un pré-tri par urgence.
    // lastActivityAt DESC, null toujours en dernier, tie-break déterministe par nom.
    items.sort((a, b) => {
      if (a.lastActivityAt && !b.lastActivityAt) return -1
      if (!a.lastActivityAt && b.lastActivityAt) return 1
      if (a.lastActivityAt && b.lastActivityAt && a.lastActivityAt !== b.lastActivityAt) {
        return a.lastActivityAt < b.lastActivityAt ? 1 : -1
      }
      return a.name.localeCompare(b.name, 'fr')
    })
  } else {
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
  }

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
