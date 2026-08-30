import Link from 'next/link'
import { Flag, HardHat } from 'lucide-react'
import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { getWeekRange } from '@/lib/week-planning-helpers'
import { SectionTitle, Empty } from './PlanningUI'

interface TravauxSubViewProps {
  items: SitePlanningItem[]
  sourceDocuments: Map<string, PlanningItemSourceDocument>
}

const weekDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
function fmtDay(iso: string): string {
  return weekDayFmt.format(new Date(iso + 'T00:00:00Z'))
}

// Planification DOCUMENTAIRE, pas une todo-list : jamais de statut « À faire »
// ou « En retard » sans preuve opérationnelle correspondante. « Prévu » dit
// seulement ce qu'un document a annoncé.
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

  return (
    <main className="space-y-4">
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <SectionTitle icon={HardHat} title="Travaux" detail="La planification documentaire du chantier." />

        <div className="mt-4 space-y-5">
          {weeks.map((week) => (
            <div key={week.key}>
              <h3 className="text-sm font-semibold text-foreground">
                Semaine {week.weekNumber} · {fmtDay(week.weekStart)}
              </h3>
              <ul className="mt-2 space-y-2">
                {week.items.map((item) => (
                  <TaskLine key={item.id} item={item} sourceDocuments={sourceDocuments} />
                ))}
              </ul>
            </div>
          ))}

          {undated.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground">Dates à préciser</h3>
              <ul className="mt-2 space-y-2">
                {undated.map((item) => (
                  <TaskLine key={item.id} item={item} sourceDocuments={sourceDocuments} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {milestones.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <SectionTitle icon={Flag} title="Jalons" detail="Les étapes qui marquent le chantier." />
          <ul className="mt-4 space-y-3">
            {milestones.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-2 w-2 shrink-0 rotate-45 bg-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {item.plannedStart ? `${fmtDay(item.plannedStart)} — ` : ''}{item.title}
                  </p>
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

function TaskLine({ item, sourceDocuments }: { item: SitePlanningItem; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  return (
    <li className="rounded-xl border p-3">
      <p className="text-sm text-foreground">{item.title}</p>
      <SourceLine item={item} sourceDocuments={sourceDocuments} />
    </li>
  )
}

function SourceLine({ item, sourceDocuments }: { item: SitePlanningItem; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  const doc = item.sourceProposalId ? sourceDocuments.get(item.sourceProposalId) : undefined
  return (
    <p className="mt-0.5 text-[12px] text-muted-foreground">
      Prévu
      {doc && (
        <>
          {' · '}{doc.filename}{' · '}
          <Link href={`/documents/${doc.documentId}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
            Voir la source
          </Link>
        </>
      )}
    </p>
  )
}

function groupByWeek(items: SitePlanningItem[]) {
  const groups = new Map<string, { key: string; weekNumber: number; weekStart: string; items: SitePlanningItem[] }>()
  for (const item of items) {
    const range = getWeekRange(item.plannedStart as string)
    const key = `${range.year}-W${range.weekNumber}`
    if (!groups.has(key)) groups.set(key, { key, weekNumber: range.weekNumber, weekStart: range.weekStart, items: [] })
    groups.get(key)!.items.push(item)
  }
  return [...groups.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}
