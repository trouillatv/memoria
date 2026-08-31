'use client'

import { Fragment, useState } from 'react'
import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { TravauxTimeline, WeekDetail } from './TravauxTimeline'
import { formatWeekRangeLabel, weekSourceExcerpts, type WeekGroup } from './travaux-week-grouping'
import { WeekProofsToggle } from './PlanningUI'

interface TravauxWeeksBoardProps {
  weeks: WeekGroup[]
  milestones: SitePlanningItem[]
  sourceDocuments: Map<string, PlanningItemSourceDocument>
  todayIso: string
  undated: SitePlanningItem[]
}

const weekDayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
function fmtDay(iso: string): string {
  return weekDayFmt.format(new Date(iso + 'T00:00:00Z'))
}

/**
 * frise → fiche de la semaine sélectionnée → autres semaines (sélectionnée
 * exclue). Une seule source de vérité pour la sélection : la fiche sous la
 * frise et la liste en dessous ne montrent jamais deux fois la même semaine.
 */
export function TravauxWeeksBoard({ weeks, milestones, sourceDocuments, todayIso, undated }: TravauxWeeksBoardProps) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const selected = weeks.find((w) => w.weekStart === selectedWeek) ?? null
  const otherWeeks = selected ? weeks.filter((w) => w.weekStart !== selectedWeek) : weeks
  const todayMarkerIndex = otherWeeks.findIndex((week) => week.weekStart > todayIso)

  return (
    <>
      <div className="mt-4">
        <TravauxTimeline
          weeks={weeks}
          milestones={milestones}
          todayIso={todayIso}
          selectedWeek={selectedWeek}
          onSelectWeek={(weekStart) => setSelectedWeek((v) => (v === weekStart ? null : weekStart))}
        />
        {selected && <WeekDetail week={selected} sourceDocuments={sourceDocuments} onClose={() => setSelectedWeek(null)} />}
      </div>

      <div className="mt-4 space-y-3">
        {otherWeeks.map((week, index) => (
          <Fragment key={week.key}>
            {index === todayMarkerIndex && <TodayMarker todayIso={todayIso} />}
            <WeekBlock week={week} sourceDocuments={sourceDocuments} />
          </Fragment>
        ))}
        {todayMarkerIndex === -1 && otherWeeks.length > 0 && <TodayMarker todayIso={todayIso} />}

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
    </>
  )
}

function WeekBlock({ week, sourceDocuments }: { week: WeekGroup; sourceDocuments: Map<string, PlanningItemSourceDocument> }) {
  const excerpts = weekSourceExcerpts(week.items, sourceDocuments)
  return (
    <div className="rounded-2xl border p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Semaine {week.weekNumber} · {formatWeekRangeLabel(week.weekStart, week.weekEnd)}
      </h3>
      <ul className="mt-3 space-y-1.5">
        {week.items.map((item) => (
          <li key={item.id} className="text-sm text-foreground">{item.title}</li>
        ))}
      </ul>
      <WeekProofsToggle itemCount={week.items.length} excerpts={excerpts} />
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
