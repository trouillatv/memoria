export type OverviewSignalKind =
  | 'blocage_active'
  | 'reserve_critical'
  | 'action_overdue'
  | 'reserve_old'
  | 'deadline_imminent'
  | 'event_upcoming'

export interface OverviewSignalInput {
  id: string
  kind: OverviewSignalKind
  title: string
  detail?: string | null
  href?: string | null
}

export interface OverviewActionInput {
  id: string
  title: string
  status: string
  dueDate: string | null
  createdAt: string
  href: string | null
}

export type OverviewChangeKind =
  | 'action_done'
  | 'reserve_created'
  | 'reserve_lifted'
  | 'blocage_created'
  | 'blocage_lifted'
  | 'meeting_held'
  | 'important_document_added'
  | 'intervention_done'
  | 'note_added'
  | 'minor_note'

export interface OverviewChangeInput {
  id: string
  kind: OverviewChangeKind
  title: string
  occurredAt: string
  detail?: string | null
  href?: string | null
}

export type OverviewEventKind = 'visit' | 'meeting' | 'intervention'

export interface OverviewEventInput {
  id: string
  kind: OverviewEventKind
  title: string
  startsAt: string
  detail?: string | null
  href?: string | null
}

const SIGNAL_PRIORITY: Record<OverviewSignalKind, number> = {
  blocage_active: 0,
  reserve_critical: 1,
  action_overdue: 2,
  reserve_old: 3,
  deadline_imminent: 4,
  event_upcoming: 5,
}

const SIGNIFICANT_CHANGE_KINDS = new Set<OverviewChangeKind>([
  'action_done',
  'reserve_created',
  'reserve_lifted',
  'blocage_created',
  'blocage_lifted',
  'meeting_held',
  'important_document_added',
  'intervention_done',
])

export function buildOverviewAttention(signals: OverviewSignalInput[], limit = 3): OverviewSignalInput[] {
  return [...signals]
    .sort((a, b) => {
      const byPriority = SIGNAL_PRIORITY[a.kind] - SIGNAL_PRIORITY[b.kind]
      if (byPriority !== 0) return byPriority
      return a.title.localeCompare(b.title, 'fr')
    })
    .slice(0, limit)
}

export function selectPriorityActions(
  actions: OverviewActionInput[],
  opts: { todayIso: string; limit?: number },
): OverviewActionInput[] {
  const limit = opts.limit ?? 5
  return actions
    .filter((a) => a.status === 'open' || a.status === 'planned')
    .map((a) => ({ action: a, rank: actionRank(a, opts.todayIso) }))
    .sort((a, b) => {
      const byBucket = a.rank.bucket - b.rank.bucket
      if (byBucket !== 0) return byBucket
      const byDate = a.rank.date.localeCompare(b.rank.date)
      if (byDate !== 0) return byDate
      return a.action.title.localeCompare(b.action.title, 'fr')
    })
    .slice(0, limit)
    .map((x) => x.action)
}

export function selectRecentChanges(
  changes: OverviewChangeInput[],
  opts: { sinceIso: string | null; limit?: number },
): OverviewChangeInput[] {
  const limit = opts.limit ?? 5
  return changes
    .filter((c) => SIGNIFICANT_CHANGE_KINDS.has(c.kind))
    .filter((c) => !opts.sinceIso || c.occurredAt > opts.sinceIso)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
}

export function selectNextEvent(events: OverviewEventInput[], nowIso: string): OverviewEventInput | null {
  return [...events]
    .filter((e) => e.startsAt >= nowIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
}

export function getActionDueTone(
  action: Pick<OverviewActionInput, 'dueDate'>,
  todayIso: string,
): 'green' | 'orange' | 'red' | 'blue' {
  if (!action.dueDate) return 'blue'
  if (action.dueDate < todayIso) return 'red'
  if (action.dueDate === todayIso || daysBetween(todayIso, action.dueDate) <= 7) return 'orange'
  return 'blue'
}

export function getActionDueLabel(
  action: Pick<OverviewActionInput, 'dueDate' | 'status'>,
  todayIso: string,
): string {
  if (!action.dueDate) return action.status === 'planned' ? 'Planifiée' : 'Sans échéance'
  if (action.dueDate < todayIso) return `En retard depuis le ${formatDayMonth(action.dueDate)}`
  if (action.dueDate === todayIso) return "Aujourd'hui"
  if (daysBetween(todayIso, action.dueDate) <= 7) return 'Cette semaine'
  return formatDayMonth(action.dueDate)
}

function actionRank(action: OverviewActionInput, todayIso: string): { bucket: number; date: string } {
  if (action.dueDate) {
    if (action.dueDate < todayIso) return { bucket: 0, date: action.dueDate }
    if (action.dueDate === todayIso) return { bucket: 1, date: action.dueDate }
    if (daysBetween(todayIso, action.dueDate) <= 7) return { bucket: 2, date: action.dueDate }
    return { bucket: 4, date: action.dueDate }
  }
  return { bucket: 3, date: action.createdAt }
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime()
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.POSITIVE_INFINITY
  return Math.floor((to - from) / 86_400_000)
}

function formatDayMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  })
}
