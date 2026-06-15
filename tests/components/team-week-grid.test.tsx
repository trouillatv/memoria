// Phase 9 — Vue Semaine & Équipes (Slice 9.5)
//
// Tests minimaux pour la vue Équipe × Jour secondaire.
//
// Couvre :
//   - Helpers purs : parseViewMode / formatViewMode, abbreviateSiteName,
//     slotLetter, compactSlotsForSite, formatMemberCount, teamCellKey
//   - TeamWeekGridCell : vide (—), affichage "Abrev m+s", aria-label
//   - TeamWeekGrid : en-tête Équipe + 7 jours, ligne par équipe, member_count
//     formaté, ligne "Non-affecté" en dernier avec data-unassigned="true"
//
// Doctrine V2 vérifiée :
//   - Aucun nom d'agent rendu dans la grille (regression)
//   - "Non-affecté" en dernier
//   - Aucune métrique (pas de %, pas de "charge")
//   - Aucun horaire précis dans les cellules

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  TeamWeekGridCell,
  abbreviateSiteName,
  slotLetter,
  compactSlotsForSite,
  teamCellKey,
} from '@/app/(dashboard)/semaine/TeamWeekGridCell'
import { TeamWeekGrid, formatMemberCount } from '@/app/(dashboard)/semaine/TeamWeekGrid'
import {
  parseViewMode,
  formatViewMode,
  DEFAULT_VIEW_MODE,
} from '@/app/(dashboard)/semaine/view-mode-storage'
import type { TeamRow, WeekInterventionCell, WeekRange } from '@/lib/db/week-planning'

// ----------------------------------------------------------------------------
// Factories
// ----------------------------------------------------------------------------

function makeCell(overrides: Partial<WeekInterventionCell> = {}): WeekInterventionCell {
  const base: WeekInterventionCell = {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    mission_id: 'm-1',
    mission_name: 'Nettoyage hall',
    site_id: 'site-chu',
    site_name: 'CHU Régional',
    contract_id: 'c-1',
    contract_name: 'Contrat Santé',
    scheduled_for: '2026-05-11',
    slot: 'morning',
    status: 'planned',
    skipped_at: null,
    assigned_team_id: 't-alpha',
    assigned_team_name: 'Alpha',
    assigned_team_color: 'sky',
    planned_start: null,
    planned_end: null,
  }
  return { ...base, ...overrides }
}

function emptyDays(): Record<string, WeekInterventionCell[]> {
  const out: Record<string, WeekInterventionCell[]> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2026, 4, 11 + i))
    out[d.toISOString().slice(0, 10)] = []
  }
  return out
}

function makeTeamRow(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    team_id: overrides.team_id ?? 't-alpha',
    team_name: overrides.team_name ?? 'Alpha',
    team_color: overrides.team_color ?? 'sky',
    member_count: overrides.member_count ?? 4,
    days: overrides.days ?? emptyDays(),
  }
}

const WEEK_RANGE: WeekRange = {
  weekStart: '2026-05-11',
  weekEnd: '2026-05-17',
  weekNumber: 20,
  year: 2026,
}

function renderInTable(child: React.ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{child}</tr>
      </tbody>
    </table>,
  )
}

// ----------------------------------------------------------------------------
// view-mode-storage
// ----------------------------------------------------------------------------

describe('parseViewMode', () => {
  it('default = site', () => {
    expect(DEFAULT_VIEW_MODE).toBe('site')
    expect(parseViewMode(undefined)).toBe('site')
    expect(parseViewMode(null)).toBe('site')
    expect(parseViewMode('')).toBe('site')
  })

  it('reconnaît team', () => {
    expect(parseViewMode('team')).toBe('team')
  })

  it('toute autre valeur retombe sur site', () => {
    expect(parseViewMode('TEAM')).toBe('site')
    expect(parseViewMode('équipe')).toBe('site')
    expect(parseViewMode('site')).toBe('site')
    expect(parseViewMode('whatever')).toBe('site')
  })
})

describe('formatViewMode', () => {
  it('site → null (URL canonique sans param)', () => {
    expect(formatViewMode('site')).toBeNull()
  })
  it('team → "team"', () => {
    expect(formatViewMode('team')).toBe('team')
  })
})

// ----------------------------------------------------------------------------
// abbreviateSiteName
// ----------------------------------------------------------------------------

describe('abbreviateSiteName', () => {
  it('mot court → renvoie tel quel', () => {
    expect(abbreviateSiteName('CHU')).toBe('CHU')
    expect(abbreviateSiteName('Éco')).toBe('Éco')
  })

  it('mot long → 4 premiers chars', () => {
    expect(abbreviateSiteName('Banque Centrale')).toBe('Banq')
    expect(abbreviateSiteName('Universite')).toBe('Univ')
  })

  it('prend le premier mot uniquement', () => {
    expect(abbreviateSiteName('CHU Régional Nord')).toBe('CHU')
  })

  it('préserve un préfixe avec tiret court (St-Marie)', () => {
    expect(abbreviateSiteName('St-Marie')).toBe('St-M')
  })

  it('chaîne vide → "—"', () => {
    expect(abbreviateSiteName('')).toBe('—')
    expect(abbreviateSiteName('   ')).toBe('—')
  })
})

// ----------------------------------------------------------------------------
// slotLetter
// ----------------------------------------------------------------------------

describe('slotLetter', () => {
  it('morning → m', () => expect(slotLetter('morning')).toBe('m'))
  it('afternoon → a', () => expect(slotLetter('afternoon')).toBe('a'))
  it('evening → s', () => expect(slotLetter('evening')).toBe('s'))
  it('null → ""', () => expect(slotLetter(null)).toBe(''))
  it('slot inconnu → ""', () => expect(slotLetter('random')).toBe(''))
})

// ----------------------------------------------------------------------------
// compactSlotsForSite
// ----------------------------------------------------------------------------

describe('compactSlotsForSite', () => {
  it('aucune cellule → ""', () => expect(compactSlotsForSite([])).toBe(''))

  it('combine m+s en ordre stable', () => {
    expect(
      compactSlotsForSite([makeCell({ slot: 'evening' }), makeCell({ slot: 'morning' })]),
    ).toBe('m+s')
  })

  it('jamais d’horaire précis (régression doctrine)', () => {
    const out = compactSlotsForSite([
      makeCell({ slot: 'morning' }),
      makeCell({ slot: 'afternoon' }),
      makeCell({ slot: 'evening' }),
    ])
    expect(out).toBe('m+a+s')
    expect(out).not.toMatch(/\d/)
  })
})

// ----------------------------------------------------------------------------
// teamCellKey
// ----------------------------------------------------------------------------

describe('teamCellKey', () => {
  it('équipe avec id', () => {
    expect(teamCellKey('t-alpha', '2026-05-11')).toBe('team::t-alpha::2026-05-11')
  })
  it('non-affecté → __unassigned__', () => {
    expect(teamCellKey(null, '2026-05-11')).toBe('team::__unassigned__::2026-05-11')
  })
})

// ----------------------------------------------------------------------------
// formatMemberCount
// ----------------------------------------------------------------------------

describe('formatMemberCount', () => {
  it('0 → "—"', () => expect(formatMemberCount(0)).toBe('—'))
  it('1 → "1 personne"', () => expect(formatMemberCount(1)).toBe('1 personne'))
  it('4 → "4 personnes"', () => expect(formatMemberCount(4)).toBe('4 personnes'))
  it('négatif/NaN → "—"', () => {
    expect(formatMemberCount(-1)).toBe('—')
    expect(formatMemberCount(Number.NaN)).toBe('—')
  })
})

// ----------------------------------------------------------------------------
// TeamWeekGridCell
// ----------------------------------------------------------------------------

describe('TeamWeekGridCell', () => {
  it('rend "—" muted quand aucune intervention', () => {
    renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[]}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(
      screen.queryByTestId('team-week-cell-t-alpha-2026-05-11'),
    ).not.toBeInTheDocument()
  })

  it('rend une ligne "Abrev + heure" pour une mission', () => {
    renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[makeCell({ site_name: 'CHU Régional', slot: 'morning', planned_start: '2026-05-11T06:30:00.000Z' })]}
      />,
    )
    const btn = screen.getByTestId('team-week-cell-t-alpha-2026-05-11')
    expect(within(btn).getByText('CHU')).toBeInTheDocument()
    expect(within(btn).getByText('6h30')).toBeInTheDocument()
  })

  it('regroupe par site avec heure de la 1re mission (créneaux horaires)', () => {
    renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[
          makeCell({
            id: 'a',
            site_id: 'site-chu',
            site_name: 'CHU Régional',
            slot: 'morning',
            planned_start: '2026-05-11T06:30:00.000Z',
          }),
          makeCell({
            id: 'b',
            site_id: 'site-chu',
            site_name: 'CHU Régional',
            slot: 'evening',
            planned_start: '2026-05-11T17:00:00.000Z',
          }),
          makeCell({
            id: 'c',
            site_id: 'site-banq',
            site_name: 'Banque Centrale',
            slot: 'evening',
            planned_start: '2026-05-11T18:00:00.000Z',
          }),
        ]}
      />,
    )
    const btn = screen.getByTestId('team-week-cell-t-alpha-2026-05-11')
    expect(within(btn).getByText('CHU')).toBeInTheDocument()
    // CHU : 2 missions → heure de la 1re + nombre de suivantes.
    expect(within(btn).getByText('6h30+1')).toBeInTheDocument()
    expect(within(btn).getByText('Banq')).toBeInTheDocument()
  })

  it('n’affiche JAMAIS de nom d’agent (régression doctrine V2)', () => {
    // On simule des cellules où "assigned_team_name" pourrait fuiter ou
    // mission_name contiendrait un nom — on vérifie qu'aucune trace d'agent
    // n'apparaît dans la cellule. Seul le site abrégé et l'heure de la mission.
    const { container } = renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[
          makeCell({
            mission_name: 'Nettoyage hall',
            site_name: 'CHU Régional',
            assigned_team_name: 'Alpha',
            slot: 'morning',
            planned_start: '2026-05-11T07:00:00.000Z',
          }),
        ]}
      />,
    )
    const text = container.textContent ?? ''
    // Aucun nom de personne fictif ne devrait apparaître (sanity check)
    expect(text).not.toMatch(/Mehdi|Sarah|Karim|Yann/i)
    // Le nom mission ne devrait pas non plus être affiché en cellule compacte
    expect(text).not.toContain('Nettoyage hall')
    // L'abréviation site ET l'heure doivent apparaître
    expect(text).toContain('CHU')
    expect(text).toContain('7h')
  })

  it('affiche l’heure de la 1re mission dans la cellule (créneaux horaires)', () => {
    // Décision Vincent 2026-06-15 : la vue d'ensemble équipe affiche désormais
    // l'heure (créneaux horaires), comme partout. Le cœur anti-RH reste : aucune
    // mesure/agrégat par personne, juste l'ancrage horaire de la prestation.
    const { container } = renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[
          makeCell({ slot: 'morning', planned_start: '2026-05-11T06:30:00.000Z' }),
          makeCell({ slot: 'evening', planned_start: '2026-05-11T17:00:00.000Z' }),
        ]}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toMatch(/6h30/)
  })

  it('expose un aria-label lisible', () => {
    renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[
          makeCell({ site_name: 'CHU Régional', slot: 'morning' }),
        ]}
      />,
    )
    const btn = screen.getByTestId('team-week-cell-t-alpha-2026-05-11')
    const label = btn.getAttribute('aria-label') ?? ''
    expect(label).toContain('Alpha')
    expect(label).toContain('2026-05-11')
    expect(label).toContain('CHU')
  })

  it('"Non-affecté" : teamId=null → testid "unassigned"', () => {
    renderInTable(
      <TeamWeekGridCell
        date="2026-05-11"
        teamId={null}
        teamName="Non-affecté"
        cells={[makeCell({ assigned_team_id: null, slot: 'morning' })]}
      />,
    )
    expect(screen.getByTestId('team-week-cell-unassigned-2026-05-11')).toBeInTheDocument()
  })

  // UX V5 — Doctrine "passé = calme visuel" (motif hachuré sobre)
  it('applique un style hachuré sobre quand la date est dans le passé', () => {
    const { container } = renderInTable(
      <TeamWeekGridCell
        date="2026-05-10"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cell = container.querySelector('[data-cell-key="team::t-alpha::2026-05-10"]')
    expect(cell?.getAttribute('data-past')).toBe('true')
    const style = cell?.getAttribute('style') ?? ''
    expect(style).toContain('repeating-linear-gradient')
    expect(style).not.toMatch(/text-decoration:\s*line-through/i)
  })

  it('n’applique PAS le style hachuré pour aujourd’hui ou le futur', () => {
    const { container: today } = renderInTable(
      <TeamWeekGridCell
        date="2026-05-13"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cellToday = today.querySelector('[data-cell-key="team::t-alpha::2026-05-13"]')
    expect(cellToday?.getAttribute('data-past')).toBe('false')
    expect(cellToday?.getAttribute('style') ?? '').not.toContain('repeating-linear-gradient')

    const { container: future } = renderInTable(
      <TeamWeekGridCell
        date="2026-05-15"
        teamId="t-alpha"
        teamName="Alpha"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cellFuture = future.querySelector('[data-cell-key="team::t-alpha::2026-05-15"]')
    expect(cellFuture?.getAttribute('data-past')).toBe('false')
    expect(cellFuture?.getAttribute('style') ?? '').not.toContain('repeating-linear-gradient')
  })
})

// ----------------------------------------------------------------------------
// TeamWeekGrid
// ----------------------------------------------------------------------------

describe('TeamWeekGrid', () => {
  it('rend une table avec colonne Équipe + 7 jours Lun→Dim', () => {
    render(<TeamWeekGrid range={WEEK_RANGE} rows={[]} todayIso="2026-05-11" />)
    const grid = screen.getByTestId('team-week-grid')
    expect(grid).toBeInTheDocument()
    expect(within(grid).getByText(/^équipe$/i)).toBeInTheDocument()
    for (const label of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) {
      expect(within(grid).getByText(label)).toBeInTheDocument()
    }
  })

  it('affiche "Alpha" + "4 personnes" (JAMAIS de noms d’agents)', () => {
    const row = makeTeamRow({ team_name: 'Alpha', member_count: 4 })
    render(<TeamWeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('4 personnes')).toBeInTheDocument()
    // Régression doctrine : aucun nom d'agent ne doit apparaître
    const html = document.body.innerHTML
    expect(html).not.toMatch(/Mehdi|Léa|Karim|Sarah|Yann|Aïcha|Tarek/)
  })

  it('classe "Non-affecté" en dernière ligne avec data-unassigned="true"', () => {
    const alpha = makeTeamRow({ team_id: 't-alpha', team_name: 'Alpha', member_count: 4 })
    const beta = makeTeamRow({ team_id: 't-beta', team_name: 'Beta', member_count: 3 })
    const unassigned: TeamRow = {
      team_id: null,
      team_name: 'Non-affecté',
      team_color: null,
      member_count: 0,
      days: emptyDays(),
    }
    const { container } = render(
      <TeamWeekGrid
        range={WEEK_RANGE}
        rows={[alpha, beta, unassigned]}
        todayIso="2026-05-11"
      />,
    )
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(3)
    expect(rows[rows.length - 1]?.getAttribute('data-unassigned')).toBe('true')
    expect(rows[rows.length - 1]?.getAttribute('data-team-id')).toBe('__unassigned__')
  })

  it('"Non-affecté" affichage ambre, JAMAIS rouge (doctrine V2)', () => {
    const unassigned: TeamRow = {
      team_id: null,
      team_name: 'Non-affecté',
      team_color: null,
      member_count: 0,
      days: emptyDays(),
    }
    const { container } = render(
      <TeamWeekGrid range={WEEK_RANGE} rows={[unassigned]} todayIso="2026-05-11" />,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/text-red-|bg-red-|text-rose-|bg-rose-/)
    expect(html).toMatch(/amber/)
  })

  it('aucune métrique de surveillance ("charge", "saturation", "%") visible', () => {
    const alpha = makeTeamRow({ team_id: 't-alpha', team_name: 'Alpha', member_count: 4 })
    const { container } = render(
      <TeamWeekGrid range={WEEK_RANGE} rows={[alpha]} todayIso="2026-05-11" />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/charge|saturation|productivité|couverture\s*\d/i)
    // Pas de pourcentage côté équipe
    expect(text).not.toMatch(/\d+\s*%/)
  })

  it('rend 7 cellules par ligne équipe', () => {
    const row = makeTeamRow()
    const { container } = render(
      <TeamWeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />,
    )
    const cells = container.querySelectorAll('[data-slot="team-week-grid-cell"]')
    expect(cells.length).toBe(7)
  })

  it('met en évidence la colonne du jour courant (data-today=true)', () => {
    render(<TeamWeekGrid range={WEEK_RANGE} rows={[]} todayIso="2026-05-13" />)
    const grid = screen.getByTestId('team-week-grid')
    const todayHeader = grid.querySelector('[data-date="2026-05-13"]')
    expect(todayHeader?.getAttribute('data-today')).toBe('true')
    const otherHeader = grid.querySelector('[data-date="2026-05-11"]')
    expect(otherHeader?.getAttribute('data-today')).toBe('false')
  })
})
