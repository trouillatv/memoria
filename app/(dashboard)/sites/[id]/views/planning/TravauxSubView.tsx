import Link from 'next/link'
import { Fragment } from 'react'
import { Flag, HardHat } from 'lucide-react'
import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { getWeekRange } from '@/lib/week-planning-helpers'
import { SectionTitle, Empty } from './PlanningUI'

interface TravauxSubViewProps {
  items: SitePlanningItem[]
  sourceDocuments: Map<string, PlanningItemSourceDocument>
}

const weekDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const milestoneDateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
function fmtDay(iso: string): string {
  return weekDayFmt.format(new Date(iso + 'T00:00:00Z'))
}
function fmtMilestoneDate(iso: string): string {
  return milestoneDateFmt.format(new Date(iso + 'T00:00:00Z'))
}

// Planification DOCUMENTAIRE, pas une todo-list : jamais de statut « À faire »
// ou « En retard » sans preuve opérationnelle correspondante. La semaine est
// le repère de lecture ; « Aujourd'hui » ne fait que situer, jamais juger.
export function TravauxSubView({ items, sourceDocuments }: TravauxSubViewProps) {
  const tasks = items.filter((i) => i.kind === 'task')
  const milestones = items.filter((i) => i.kind === 'milestone').sort((a, b) => (a.plannedStart ?? '').localeCompare(b.plannedStart ?? ''))

  if (items.length === 0) {
    return (
      <main className="space-y-4">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={HardHat} title="Travaux" detail="La planification documentaire du chantier." />
          <div className="mt-4"><Empty>Aucun planning de travaux documenté pour ce chantier.</Empty></div>
        </section>
      </main>
    )
  }

  const dated = tasks.filter((t) => t.plannedStart)
  const undated = tasks.filter((t) => !t.plannedStart)
  const weeks = groupByWeek(dated)
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayMarkerIndex = weeks.findIndex((week) => week.weekStart > todayIso)

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={HardHat} title="Travaux" detail="La planification documentaire du chantier." />

        <div className="mt-4 space-y-3">
          {weeks.map((week, index) => (
            <Fragment key={week.key}>
              {index === todayMarkerIndex && <TodayMarker todayIso={todayIso} />}
              <WeekBlock week={week} sourceDocuments={sourceDocuments} />
            </Fragment>
          ))}
          {todayMarkerIndex === -1 && weeks.length > 0 && <TodayMarker todayIso={todayIso} />}

          {undated.length > 0 && (
            <div className="rounded-2xl border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dates à préciser</h3>
              <ul className="mt-2 space-y-1.5">
                {undated.map((item) => (
                  <li key={item.id} className="text-sm text-foreground">{item.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {milestones.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Flag} title="Jalons" detail="Les étapes qui marquent le chantier." />
          <ul className="mt-4 space-y-4">
            {milestones.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rotate-45 bg-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  {item.plannedStart && (
                    <p className="text-sm text-muted-foreground tabular-nums">{fmtMilestoneDate(item.plannedStart)}</p>
                  )}
                  <SourceLine item={item} sourceDocuments={sourceDocuments} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function WeekBlock({ week, sourceDocuments }: { week: WeekGroup; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  const sources = weekSources(week.items, sourceDocuments)
  return (
    <div className="rounded-2xl border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Semaine {week.weekNumber}</h3>
      <p className="text-sm font-medium text-foreground">{fmtDay(week.weekStart)} → {fmtDay(week.weekEnd)}</p>
      <ul className="mt-3 space-y-1.5">
        {week.items.map((item) => (
          <li key={item.id} className="text-sm text-foreground">{item.title}</li>
        ))}
      </ul>
      {sources.length > 0 && (
        <div className="mt-3 space-y-0.5 border-t pt-2">
          {sources.map((doc) => (
            <p key={doc.documentId} className="text-[12px] text-muted-foreground">
              Source : {doc.filename}{' · '}
              <Link href={`/documents/${doc.documentId}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
                Voir la source
              </Link>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function TodayMarker({ todayIso }: { todayIso: string }) {
  return (
    <div className="flex items-center gap-3 px-1" role="separator" aria-label={`Aujourd'hui · ${fmtDay(todayIso)}`}>
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Aujourd'hui · {fmtDay(todayIso)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function SourceLine({ item, sourceDocuments }: { item: SitePlanningItem; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
  if (!doc) return null
  return (
    <p className="mt-0.5 text-[12px] text-muted-foreground">
      Source : {doc.filename}{' · '}
      <Link href={`/documents/${doc.documentId}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
        Voir la source
      </Link>
    </p>
  )
}

interface WeekGroup {
  key: string
  weekNumber: number
  weekStart: string
  weekEnd: string
  items: SitePlanningItem[]
}

function groupByWeek(items: SitePlanningItem[]): WeekGroup[] {
  const groups = new Map<string, WeekGroup>()
  for (const item of items) {
    const range = getWeekRange(item.plannedStart as string)
    const key = `${range.year}-W${range.weekNumber}`
    if (!groups.has(key)) groups.set(key, { key, weekNumber: range.weekNumber, weekStart: range.weekStart, weekEnd: range.weekEnd, items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

function weekSources(items: SitePlanningItem[], sourceDocuments: Map<string, PlanningItemSourceDocument>): PlanningItemSourceDocument[] {
  const seen = new Map<string, PlanningItemSourceDocument>()
  for (const item of items) {
    const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
    if (doc) seen.set(doc.documentId, doc)
  }
  return [...seen.values()]
}
