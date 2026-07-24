import { createAdminClient } from '@/lib/supabase/admin'

export type SiteStatus = 'critical' | 'warning' | 'normal'

export type SiteDashboardItem = {
  id: string
  name: string
  organizationId: string
  clientName: string | null
  activeActionCount: number
  overdueActionCount: number
  openReserveCount: number
  lastActivityAt: string | null
  nextPassageAt: string | null
  status: SiteStatus
  href: string
}

export async function getSitesDashboard(orgIds: string[]): Promise<SiteDashboardItem[]> {
  if (orgIds.length === 0) return []
  const supabase = createAdminClient()

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

  const [actionRes, reserveRes, reportRes, eventRes] = await Promise.all([
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
      clientName: site.client_id ? (clientNames.get(site.client_id) ?? null) : null,
      activeActionCount: active,
      overdueActionCount: overdue,
      openReserveCount: reserve,
      lastActivityAt: last,
      nextPassageAt: next,
      status,
      href: `/sites/${site.id}`,
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

  return items.slice(0, 5)
}
