import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayFocusPanel } from '@/app/(dashboard)/(planning)/DayFocusPanel'
import type { MonthRow } from '@/lib/db/month-view'
import type { SiteRow, WeekInterventionCell } from '@/lib/db/week-planning'
import type { ProjectableClosure } from '@/lib/planning/closures'

const DATE = '2026-09-29'

function cell(overrides: Partial<WeekInterventionCell> = {}): WeekInterventionCell {
  return {
    id: 'itv-1',
    mission_id: 'mission-1',
    mission_name: 'Entretien Carrelage',
    site_id: 'site-1',
    site_name: 'OCEF Compostage',
    client_name: null,
    contract_id: 'contract-1',
    contract_name: 'Contrat OCEF',
    scheduled_for: DATE,
    slot: 'morning',
    status: 'planned',
    skipped_at: null,
    assigned_team_id: 'team-1',
    assigned_team_name: 'DISCOUNT P1',
    assigned_team_color: 'sky',
    template_id: 'tpl-1',
    planned_start: '2026-09-29T07:00:00.000Z',
    planned_end: '2026-09-29T09:00:00.000Z',
    ...overrides,
  }
}

function siteRow(cells: WeekInterventionCell[] = []): SiteRow {
  return {
    site_id: 'site-1',
    site_name: 'OCEF Compostage',
    client_name: null,
    contract_id: 'contract-1',
    contract_name: 'Contrat OCEF',
    days: { [DATE]: cells },
  }
}

function monthRow(overrides: Partial<MonthRow['days'][string]> = {}): MonthRow {
  return {
    siteId: 'site-1',
    siteName: 'OCEF Compostage',
    clientName: null,
    days: {
      [DATE]: {
        expected: 0,
        done: 0,
        kept: 0,
        projected: 1,
        closed: false,
        hasException: false,
        cycleCovers: true,
        projectedOccurrences: [
          {
            templateId: 'tpl-1',
            missionId: 'mission-1',
            missionName: 'Entretien Carrelage',
            plannedStart: '2026-09-29T07:00:00.000Z',
            plannedEnd: '2026-09-29T09:00:00.000Z',
            slot: 'morning',
            assignedTeamId: 'team-1',
            assignedTeamName: 'DISCOUNT P1',
            assignedTeamColor: 'sky',
          },
        ],
        ...overrides,
      },
    },
  }
}

function closure(): ProjectableClosure {
  return {
    id: 'closure-1',
    siteId: 'site-1',
    reasonKind: 'client',
    reason: null,
    startsOn: DATE,
    endsOn: DATE,
    defaultResolution: 'move',
  }
}

function renderPanel(props: Partial<Parameters<typeof DayFocusPanel>[0]> = {}) {
  return render(
    <DayFocusPanel
      date={DATE}
      month="2026-09"
      siteRows={[]}
      monthRows={[]}
      conflictsBySite={{}}
      closuresBySite={{}}
      weekHref="/semaine?week=2026-W40"
      {...props}
    />,
  )
}

describe('DayFocusPanel mois', () => {
  it('affiche une projection seule comme Prevu par le rythme, jamais comme rien de prevu', () => {
    renderPanel({ siteRows: [siteRow()], monthRows: [monthRow()] })

    expect(screen.getByText('Prévu par le rythme')).toBeInTheDocument()
    expect(screen.getByText('Entretien Carrelage')).toBeInTheDocument()
    expect(screen.getByText('DISCOUNT P1')).toBeInTheDocument()
    expect(screen.getByText('Aucune intervention matérialisée pour cette date.')).toBeInTheDocument()
    expect(screen.queryByText('Rien de prévu ce jour-là.')).not.toBeInTheDocument()
  })

  it('affiche une intervention materialisee sans fabriquer de projection', () => {
    renderPanel({ siteRows: [siteRow([cell()])] })

    expect(screen.getByText('Intervention planifiée')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Voir l'intervention" })).toHaveAttribute('href', '/interventions/itv-1')
    expect(screen.queryByText('Prévu par le rythme')).not.toBeInTheDocument()
    expect(screen.queryByText('Rien de prévu ce jour-là.')).not.toBeInTheDocument()
  })

  it('affiche intervention et projection sans message ambigu de vide', () => {
    renderPanel({
      siteRows: [siteRow([cell({ id: 'itv-2', template_id: 'tpl-2' })])],
      monthRows: [monthRow()],
    })

    expect(screen.getByText('Intervention planifiée')).toBeInTheDocument()
    expect(screen.getByText('Prévu par le rythme')).toBeInTheDocument()
    expect(screen.queryByText('Aucune intervention matérialisée pour cette date.')).not.toBeInTheDocument()
    expect(screen.queryByText('Rien de prévu ce jour-là.')).not.toBeInTheDocument()
  })

  it('affiche le vrai vide seulement sans projection, intervention, fermeture ou conflit', () => {
    renderPanel()
    expect(screen.getByText('Rien de prévu ce jour-là.')).toBeInTheDocument()
  })

  it('conserve la lecture fermeture et conflit', () => {
    const c = closure()
    renderPanel({
      siteRows: [siteRow()],
      closuresBySite: { 'site-1': { [DATE]: c } },
      conflictsBySite: { 'site-1': { [DATE]: { closure: c, expectedCount: 1 } } },
    })

    expect(screen.getByText(/1 conflit/)).toBeInTheDocument()
    expect(screen.queryByText('Rien de prévu ce jour-là.')).not.toBeInTheDocument()
  })
})

describe('MonthPlanningClient source contract', () => {
  it('selectionne un jour via etat client et History API, sans Link focus serveur', () => {
    const src = readFileSync(join(process.cwd(), 'app/(dashboard)/(planning)/mois/MonthPlanningClient.tsx'), 'utf8')
    expect(src).toContain('useState(initialFocusDate)')
    expect(src).toContain('window.history.pushState')
    expect(src).toContain('onSelectDate={selectDate}')
  })
})
