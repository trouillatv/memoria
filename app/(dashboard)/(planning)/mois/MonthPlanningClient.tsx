'use client'

import { useCallback, useEffect, useState } from 'react'
import { WeekGridClient } from '../semaine/WeekGridClient'
import { MonthCalendarGrid } from './MonthCalendarGrid'
import { DayFocusPanel } from '../DayFocusPanel'
import { LecturePanel, type LecturePanelLinks } from '../LecturePanel'
import { isoWeekParamOf } from '@/lib/planning/month-view'
import type { MonthRow } from '@/lib/db/month-view'
import type { SiteRow } from '@/lib/db/week-planning'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { ProjectableClosure } from '@/lib/planning/closures'
import type { ClosureDecision } from '@/lib/db/closure-decisions'
import type { ResolutionOption } from '@/lib/planning/conflict-resolution'
import type { PlanningLecture } from '@/lib/planning/lecture'
import type { ReassignTeamOption } from '../semaine/ReassignTeamDialog'

export function MonthPlanningClient({
  gridRows,
  siteRows,
  month,
  todayIso,
  initialFocusDate,
  teams,
  conflictsBySite,
  closuresBySite,
  decisions,
  optionsBySite,
  exceptionsById,
  initialCellKey,
  lecture,
  lectureLinks,
  emptyContextLabel,
  rotationCount,
  interventionCount,
  assignmentCount,
  emptyMonth,
}: {
  gridRows: MonthRow[]
  siteRows: SiteRow[]
  month: string
  todayIso: string
  initialFocusDate?: string
  teams: ReassignTeamOption[]
  conflictsBySite: Record<string, Record<string, ClosureConflict>>
  closuresBySite: Record<string, Record<string, ProjectableClosure>>
  decisions: Record<string, ClosureDecision>
  optionsBySite: Record<string, Record<string, ResolutionOption[]>>
  exceptionsById: Record<string, string[]>
  initialCellKey: string | null
  lecture: PlanningLecture | null
  lectureLinks: LecturePanelLinks
  emptyContextLabel: string
  rotationCount: number
  interventionCount: number
  assignmentCount: number
  emptyMonth: boolean
}) {
  const [focusDate, setFocusDate] = useState(initialFocusDate)

  const updateFocusUrl = useCallback((nextFocus: string | undefined) => {
    const url = new URL(window.location.href)
    url.searchParams.set('m', month)
    if (nextFocus) url.searchParams.set('focus', nextFocus)
    else url.searchParams.delete('focus')
    window.history.pushState(null, '', url)
  }, [month])

  const selectDate = useCallback((date: string) => {
    setFocusDate(date)
    updateFocusUrl(date)
  }, [updateFocusUrl])

  const clearFocus = useCallback(() => {
    setFocusDate(undefined)
    updateFocusUrl(undefined)
  }, [updateFocusUrl])

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      const raw = params.get('focus') ?? undefined
      setFocusDate(raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw.startsWith(month) ? raw : undefined)
    }
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [month])

  return (
    <>
      <div>
        {emptyMonth ? (
          <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            Rien à projeter ce mois-ci : aucune intervention, aucun roulement, aucune fermeture.
          </p>
        ) : (
          <WeekGridClient
            rows={siteRows}
            todayIso={todayIso}
            teams={teams}
            conflictsBySite={conflictsBySite}
            closuresBySite={closuresBySite}
            decisions={decisions}
            optionsBySite={optionsBySite}
            exceptionsById={exceptionsById}
            initialCellKey={initialCellKey}
          >
            <MonthCalendarGrid
              rows={gridRows}
              month={month}
              todayIso={todayIso}
              focusDate={focusDate}
              onSelectDate={selectDate}
            />
          </WeekGridClient>
        )}
      </div>
      {focusDate ? (
        <DayFocusPanel
          date={focusDate}
          month={month}
          siteRows={siteRows}
          monthRows={gridRows}
          conflictsBySite={conflictsBySite}
          closuresBySite={closuresBySite}
          weekHref={`/semaine?week=${isoWeekParamOf(focusDate)}`}
          onClearFocus={clearFocus}
        />
      ) : (
        <LecturePanel
          lecture={lecture}
          links={lectureLinks}
          emptyContextLabel={emptyContextLabel}
          rotationCount={rotationCount}
          interventionCount={interventionCount}
          assignmentCount={assignmentCount}
        />
      )}
    </>
  )
}
