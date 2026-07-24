import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import type { UpcomingDashboardItem } from '@/lib/db/upcoming-items'
import { todayLocalIso } from '@/lib/time/local-date'

export type NowItemSource = 'action' | 'deadline' | 'passage'
export type NowItemPriority = 'urgent' | 'today' | 'soon'

export type NowDashboardItem = {
  id: string
  sourceType: NowItemSource
  title: string
  siteId: string
  siteName: string
  href: string
  dueDate: string | null
  startsAt: string | null
  priority: NowItemPriority
  canComplete: boolean
  actionId: string | null
}

export type NowDashboardSummary = {
  overdueActions: number
  imminentPassages: number
  weekDeadlines: number
}

export async function getNowDashboard(
  orgIds: string[],
  upcoming: UpcomingDashboardItem[],
): Promise<{ items: NowDashboardItem[]; summary: NowDashboardSummary; actions: SiteActionRow[] }> {
  const actions = await listOpenSiteActions({ orgIds, statuses: ['open', 'planned'] })
  const today = todayLocalIso()
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const overdue = actions.filter((a) => !!a.due_date && a.due_date < today)
  const weekDeadlines = actions.filter((a) => a.kind === 'deadline' && !!a.due_date && a.due_date >= today && a.due_date <= horizon)
  const imminent = upcoming.filter((item) => new Date(item.startsAt).getTime() <= Date.now() + 48 * 3_600_000)

  const actionItems: NowDashboardItem[] = [...overdue, ...actions.filter((a) => a.due_date === today)]
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .map((action) => ({
      id: `action:${action.id}`,
      sourceType: action.kind === 'deadline' ? 'deadline' : 'action',
      title: action.title,
      siteId: action.site_id,
      siteName: action.site_name,
      href: `/sites/${action.site_id}/actions`,
      dueDate: action.due_date,
      startsAt: null,
      priority: action.due_date && action.due_date < today ? 'urgent' : 'today',
      canComplete: true,
      actionId: action.id,
    }))

  const passageItems: NowDashboardItem[] = imminent.slice(0, 2).map((item) => ({
    id: `passage:${item.sourceType}:${item.id}`,
    sourceType: 'passage',
    title: item.title,
    siteId: item.siteId,
    siteName: item.siteName,
    href: item.href,
    dueDate: null,
    startsAt: item.startsAt,
    priority: item.isToday ? 'today' : 'soon',
    canComplete: false,
    actionId: null,
  }))

  const items = [...actionItems, ...passageItems].slice(0, 5)
  return {
    items,
    summary: { overdueActions: overdue.length, imminentPassages: imminent.length, weekDeadlines: weekDeadlines.length },
    actions,
  }
}
