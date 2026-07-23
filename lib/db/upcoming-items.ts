import { createAdminClient } from '@/lib/supabase/admin'

export type UpcomingItemKind = 'inspection' | 'meeting' | 'delivery' | 'other'

export type UpcomingDashboardItem = {
  id: string
  sourceType: 'scheduled_event'
  organizationId: string
  siteId: string
  siteName: string
  clientName: string | null
  title: string
  kind: UpcomingItemKind
  startsAt: string
  isToday: boolean
  isOverdue: boolean
  href: string
}

export async function getUpcomingItems(
  orgIds: string[],
  horizonDays = 30,
): Promise<UpcomingDashboardItem[]> {
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

  const siteMap = new Map<string, SiteRow>(sites.map((s) => [s.id, s]))
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
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea' }).format(now)

  const { data: evRows } = await supabase
    .from('site_scheduled_events')
    .select('id, site_id, type, title, planned_start')
    .in('site_id', siteIds)
    .gt('planned_start', now.toISOString())
    .lte('planned_start', horizon.toISOString())
    .order('planned_start', { ascending: true })
    .limit(50)

  const items: UpcomingDashboardItem[] = []
  for (const ev of (evRows ?? []) as Array<{
    id: string
    site_id: string
    type: string
    title: string
    planned_start: string
  }>) {
    const site = siteMap.get(ev.site_id)
    if (!site) continue
    const evDay = ev.planned_start.slice(0, 10)
    const kind: UpcomingItemKind = (['inspection', 'meeting', 'delivery'].includes(ev.type)
      ? ev.type
      : 'other') as UpcomingItemKind

    items.push({
      id: ev.id,
      sourceType: 'scheduled_event',
      organizationId: site.organization_id,
      siteId: site.id,
      siteName: site.name,
      clientName: site.client_id ? (clientNames.get(site.client_id) ?? null) : null,
      title: ev.title,
      kind,
      startsAt: ev.planned_start,
      isToday: evDay === todayStr,
      isOverdue: false,
      href: `/sites/${site.id}`,
    })
  }

  return items.slice(0, 10)
}
