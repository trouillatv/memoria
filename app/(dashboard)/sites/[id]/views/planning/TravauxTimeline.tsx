'use client'

import { useEffect, useRef } from 'react'
import type { SitePlanningItem, PlanningItemSourceDocument } from '@/lib/db/site-planning-items'
import { weekOf, weekSourceExcerpts, type WeekGroup } from './travaux-week-grouping'
import { SourceExcerpt } from './PlanningUI'

const dayLongFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const monthYearFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const monthBandFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long' })
function fmtDayLong(iso: string): string {
  return dayLongFmt.format(new Date(iso + 'T00:00:00Z'))
}
function fmtMonthYear(iso: string): string {
  return monthYearFmt.format(new Date(iso + 'T00:00:00Z'))
}

interface TravauxTimelineProps {
  weeks: WeekGroup[]
  milestones: SitePlanningItem[]
  todayIso: string
  selectedWeek: string | null
  onSelectWeek: (weekStart: string) => void
}

/**
 * Frise horizontale = vue d'ensemble de la trajectoire PRÉVUE (planning
 * documentaire), pas un état d'avancement : aucune couleur de statut, aucun
 * pourcentage. La sélection (fiche + liste des autres semaines) est pilotée
 * par le parent — cette frise ne fait que montrer le temps et remonter les
 * clics, elle ne duplique jamais le contenu détaillé d'une semaine.
 *
 * Fenêtre temporelle défilante, pas six cases fixes : au montage, la semaine
 * la plus proche d'aujourd'hui se centre dans le viewport ; au clic, la
 * semaine choisie s'y recentre en douceur.
 *
 * Géométrie en grille (une colonne par semaine) pensée pour qu'une future
 * ligne « Constaté » (visites/PV/CR) puisse s'aligner dessous sur le même
 * axe semaine sans refonte — cette ligne n'existe pas encore ici.
 */
export function TravauxTimeline({ weeks, milestones, todayIso, selectedWeek, onSelectWeek }: TravauxTimelineProps) {
  const weekRefs = useRef(new Map<string, HTMLButtonElement>())
  const todayMarkerIndex = weeks.findIndex((w) => w.weekStart > todayIso)

  // Centre la semaine la plus proche d'aujourd'hui au montage — pas de scroll
  // fluide ici (behavior: 'auto'), c'est un positionnement initial, pas une
  // navigation. Ne se redéclenche jamais sur les re-rendus de sélection.
  useEffect(() => {
    const centerIndex = todayMarkerIndex !== -1 ? todayMarkerIndex : weeks.length - 1
    const centerWeek = weeks[centerIndex]
    const el = centerWeek ? weekRefs.current.get(centerWeek.weekStart) : undefined
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (weeks.length === 0) return null

  const nearMilestones = new Map<string, SitePlanningItem[]>()
  const farMilestones: SitePlanningItem[] = []
  for (const m of milestones) {
    if (!m.plannedStart) continue
    const wk = weekOf(m.plannedStart)
    const match = weeks.find((w) => w.weekStart === wk)
    if (match) {
      if (!nearMilestones.has(match.weekStart)) nearMilestones.set(match.weekStart, [])
      nearMilestones.get(match.weekStart)!.push(m)
    } else {
      farMilestones.push(m)
    }
  }

  const todayAfterAll = todayMarkerIndex === -1
  const bands = monthBands(weeks)
  const columns = `repeat(${weeks.length}, minmax(96px, 1fr))`

  return (
    <div className="rounded-2xl border p-4">
      <div className="overflow-x-auto pt-4">
        <div className="inline-grid w-full gap-x-0" style={{ gridTemplateColumns: columns }}>
          {bands.map((band, i) => (
            <div
              key={`${band.label}-${i}`}
              style={{ gridColumn: `span ${band.span}` }}
              className="truncate px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
            >
              {band.label}
            </div>
          ))}

          {weeks.map((week, index) => (
            <div key={week.key} className="relative flex justify-center border-t px-1 pt-2">
              {index === todayMarkerIndex && <TodayFlag />}
              <button
                ref={(el) => {
                  if (el) weekRefs.current.set(week.weekStart, el)
                  else weekRefs.current.delete(week.weekStart)
                }}
                type="button"
                onClick={(e) => {
                  onSelectWeek(week.weekStart)
                  e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
                }}
                className={`w-full rounded-lg px-1 py-1.5 text-center transition-colors hover:bg-muted/40 ${selectedWeek === week.weekStart ? 'bg-muted/60' : ''}`}
                aria-expanded={selectedWeek === week.weekStart}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">S{week.weekNumber}</p>
                <p className="mt-1 text-[11px] tabular-nums text-foreground">{week.items.length} trav.</p>
                {nearMilestones.has(week.weekStart) && (
                  <p className="mt-0.5 text-[11px] text-foreground" title={nearMilestones.get(week.weekStart)!.map((m) => m.title).join(', ')}>
                    ◆
                  </p>
                )}
              </button>
            </div>
          ))}
        </div>
        {todayAfterAll && (
          <div className="mt-1 flex justify-end pr-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Aujourd'hui →</span>
          </div>
        )}
      </div>

      {farMilestones.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t pt-2">
          {farMilestones.map((m) => (
            <p key={m.id} className="text-[12px] text-muted-foreground">
              → {fmtMonthYear(m.plannedStart!)} · ◆ {m.title}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function TodayFlag() {
  return (
    <div className="pointer-events-none absolute -top-4 left-0 flex -translate-x-1/2 flex-col items-center" aria-hidden>
      <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Aujourd&apos;hui</span>
      <span className="mt-0.5 h-3 w-px bg-sky-400" />
    </div>
  )
}

/** Fiche de détail d'une semaine — rendue une seule fois par le parent
 *  (sous la frise quand sélectionnée), jamais dupliquée dans la liste. */
export function WeekDetail({ week, sourceDocuments, onClose }: { week: WeekGroup; sourceDocuments: Map<string, PlanningItemSourceDocument>; onClose: () => void }) {
  const excerpts = weekSourceExcerpts(week.items, sourceDocuments)
  return (
    <div className="mt-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Semaine {week.weekNumber} · {fmtDayLong(week.weekStart)} → {fmtDayLong(week.weekEnd)}
        </p>
        <button type="button" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Fermer le détail de la semaine">
          ×
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {week.items.map((item) => (
          <li key={item.id} className="text-sm text-foreground">{item.title}</li>
        ))}
      </ul>
      {excerpts.length > 0 && (
        <div className="mt-2 space-y-2 border-t pt-2">
          {excerpts.map((e) => (
            <SourceExcerpt key={e.key} documentId={e.documentId} filename={e.filename} excerpt={e.excerpt} />
          ))}
        </div>
      )}
    </div>
  )
}

function monthBands(weeks: WeekGroup[]): { label: string; span: number }[] {
  const bands: { label: string; span: number }[] = []
  for (const week of weeks) {
    const label = monthBandFmt.format(new Date(week.weekStart + 'T00:00:00Z')).toUpperCase()
    const last = bands[bands.length - 1]
    if (last && last.label === label) last.span += 1
    else bands.push({ label, span: 1 })
  }
  return bands
}
