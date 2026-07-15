// Phase 9 — Vue Semaine & Équipes (Slice 9.3)
//
// Tests minimaux des composants /semaine.
//
// On vérifie :
//   - Helpers purs : compactSlots, dominantTeam
//   - WeekGridCell : rendu vide (—), affecté (●/●● + slots + TeamBadge),
//     non-affecté (◯ ambre), accessibilité (aria-label, scope, data-testid)
//   - WeekGrid : structure thead/tbody, 7 colonnes jours, label site + contrat
//   - CellDrawer : event delegation au click cellule
//
// Doctrine V2 vérifiée :
//   - Aucun render d'horaire précis dans les cellules
//   - "Non-affecté" en cellule = ambre (jamais rouge)
//   - Aucun affichage de métrique

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// V6.1 — CellDrawer importe EditInterventionTimeDialog qui utilise
// useRouter(). Mock pour environnement test (pas de RouterContext).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// La chaîne d'imports tire transitivement @/lib/scheduling/team-conflict
// qui a un guard `server-only`. Neutralisé en env test.
vi.mock('server-only', () => ({}))
import { WeekGridCell, compactSlots, dominantTeam } from '@/app/(dashboard)/(planning)/semaine/WeekGridCell'
import { WeekGrid, PlanningGrid } from '@/app/(dashboard)/(planning)/semaine/WeekGrid'
import { CellDrawer } from '@/app/(dashboard)/(planning)/semaine/CellDrawer'
import type {
  SiteRow,
  WeekInterventionCell,
  WeekRange,
} from '@/lib/db/week-planning'
import type { MonthRow } from '@/lib/db/month-view'
import type { DayFacts } from '@/lib/planning/month-view'

// ----------------------------------------------------------------------------
// Factories
// ----------------------------------------------------------------------------

function makeCell(overrides: Partial<WeekInterventionCell> = {}): WeekInterventionCell {
  // Note : on N'UTILISE PAS `??` car certains champs (`slot`,
  // `assigned_team_id`) acceptent `null` comme valeur signifiante du test.
  const base: WeekInterventionCell = {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    mission_id: 'm-1',
    mission_name: 'Nettoyage hall',
    site_id: 'site-1',
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

const WEEK_RANGE: WeekRange = {
  weekStart: '2026-05-11',
  weekEnd: '2026-05-17',
  weekNumber: 20,
  year: 2026,
}

function emptyDays(): Record<string, WeekInterventionCell[]> {
  const out: Record<string, WeekInterventionCell[]> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2026, 4, 11 + i))
    out[d.toISOString().slice(0, 10)] = []
  }
  return out
}

function makeSiteRow(overrides: Partial<SiteRow> = {}): SiteRow {
  return {
    site_id: overrides.site_id ?? 'site-1',
    site_name: overrides.site_name ?? 'CHU Régional',
    contract_id: overrides.contract_id ?? 'c-1',
    contract_name: overrides.contract_name ?? 'Contrat Santé',
    days: overrides.days ?? emptyDays(),
  }
}

// ----------------------------------------------------------------------------
// Helpers purs — compactSlots, dominantTeam
// ----------------------------------------------------------------------------

describe('compactSlots', () => {
  it('renvoie chaîne vide pour aucune cellule', () => {
    expect(compactSlots([])).toBe('')
  })

  it('mappe morning → m', () => {
    expect(compactSlots([makeCell({ slot: 'morning' })])).toBe('m')
  })

  it('mappe afternoon → a', () => {
    expect(compactSlots([makeCell({ slot: 'afternoon' })])).toBe('a')
  })

  it('mappe evening → s (soir)', () => {
    expect(compactSlots([makeCell({ slot: 'evening' })])).toBe('s')
  })

  it('combine plusieurs slots dans l’ordre m → a → s', () => {
    const cells = [
      makeCell({ slot: 'evening' }),
      makeCell({ slot: 'morning' }),
    ]
    expect(compactSlots(cells)).toBe('m+s')
  })

  it('dédoublonne les slots identiques', () => {
    const cells = [
      makeCell({ slot: 'morning', id: 'a' }),
      makeCell({ slot: 'morning', id: 'b' }),
    ]
    expect(compactSlots(cells)).toBe('m')
  })

  it('ignore les slots null sans erreur', () => {
    expect(compactSlots([makeCell({ slot: null })])).toBe('')
  })

  it('n’expose JAMAIS d’horaire précis (régression doctrine)', () => {
    const out = compactSlots([
      makeCell({ slot: 'morning' }),
      makeCell({ slot: 'afternoon' }),
      makeCell({ slot: 'evening' }),
    ])
    expect(out).not.toMatch(/\d/)
    expect(out).toBe('m+a+s')
  })
})

describe('dominantTeam', () => {
  it('renvoie null si aucune intervention n’est affectée', () => {
    expect(
      dominantTeam([
        makeCell({ assigned_team_id: null, assigned_team_name: null, assigned_team_color: null, planned_start: null, planned_end: null }),
      ]),
    ).toBeNull()
  })

  it('renvoie la team unique si une seule affectée', () => {
    const team = dominantTeam([makeCell({ assigned_team_id: 't-alpha', assigned_team_name: 'Alpha' })])
    expect(team?.id).toBe('t-alpha')
    expect(team?.name).toBe('Alpha')
  })

  it('renvoie la team la plus fréquente en cas de mixage', () => {
    const team = dominantTeam([
      makeCell({ assigned_team_id: 't-alpha', assigned_team_name: 'Alpha' }),
      makeCell({ assigned_team_id: 't-alpha', assigned_team_name: 'Alpha' }),
      makeCell({ assigned_team_id: 't-beta', assigned_team_name: 'Beta' }),
    ])
    expect(team?.name).toBe('Alpha')
  })

  it('ignore les non-affectées dans le décompte', () => {
    const team = dominantTeam([
      makeCell({ assigned_team_id: null, assigned_team_name: null }),
      makeCell({ assigned_team_id: 't-beta', assigned_team_name: 'Beta' }),
    ])
    expect(team?.name).toBe('Beta')
  })
})

// ----------------------------------------------------------------------------
// WeekGridCell
// ----------------------------------------------------------------------------

function renderInTable(child: React.ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{child}</tr>
      </tbody>
    </table>,
  )
}

describe('WeekGridCell', () => {
  it('rend un placeholder muted "—" quand aucune intervention', () => {
    renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[]}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    // pas de bouton interactif → pas de testid cell-trigger
    expect(screen.queryByTestId('week-cell-s1-2026-05-11')).not.toBeInTheDocument()
  })

  it('affiche ● + TeamBadge pour une mission affectée', () => {
    renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[
          makeCell({
            slot: 'morning',
            assigned_team_id: 't-alpha',
            assigned_team_name: 'Alpha',
            assigned_team_color: 'sky',
    planned_start: null,
    planned_end: null,
          }),
        ]}
      />,
    )
    const btn = screen.getByTestId('week-cell-s1-2026-05-11')
    expect(btn).toBeInTheDocument()
    expect(within(btn).getByText('●')).toBeInTheDocument()
    // V6.1 : plus de lettre de créneau (« m ») dans la cellule — on n'affiche
    // que l'heure de prestation (vide ici car planned_start null) + l'équipe.
    expect(within(btn).getByText('Alpha')).toBeInTheDocument()
  })

  it('affiche ●● pour 2+ missions', () => {
    renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[
          makeCell({ id: 'a', slot: 'morning' }),
          makeCell({ id: 'b', slot: 'evening' }),
        ]}
      />,
    )
    expect(screen.getByText('●●')).toBeInTheDocument()
    // V6.1 : la pluralité est portée par ●●, plus par les lettres « m+s ».
  })

  it('affiche ◯ ambre + "Non-affecté" si AUCUNE intervention n’a d’équipe', () => {
    renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[
          makeCell({
            assigned_team_id: null,
            assigned_team_name: null,
            assigned_team_color: null,
    planned_start: null,
    planned_end: null,
          }),
        ]}
      />,
    )
    expect(screen.getByText('◯')).toBeInTheDocument()
    expect(screen.getByText(/non-affecté/i)).toBeInTheDocument()
    const td = screen.getByTestId('week-cell-s1-2026-05-11').closest('td')
    expect(td?.getAttribute('data-unassigned')).toBe('true')
  })

  it('ne JAMAIS rendre de couleur rouge pour "Non-affecté" (doctrine V2)', () => {
    const { container } = renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[
          makeCell({
            assigned_team_id: null,
            assigned_team_name: null,
            assigned_team_color: null,
    planned_start: null,
    planned_end: null,
          }),
        ]}
      />,
    )
    const html = container.innerHTML
    // Aucune classe rose/red ne doit apparaître
    expect(html).not.toMatch(/text-red-|bg-red-|text-rose-|bg-rose-/)
    // Mais l'ambre est attendu
    expect(html).toMatch(/amber/)
  })

  it('expose un aria-label lisible pour l’accessibilité', () => {
    renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU Régional"
        cells={[
          makeCell({
            slot: 'morning',
            assigned_team_id: 't-alpha',
            assigned_team_name: 'Alpha',
          }),
        ]}
      />,
    )
    const btn = screen.getByTestId('week-cell-s1-2026-05-11')
    const label = btn.getAttribute('aria-label') ?? ''
    expect(label).toContain('CHU Régional')
    expect(label).toContain('2026-05-11')
    expect(label).toContain('Alpha')
  })

  it('n’affiche jamais d’heure précise dans la cellule (régression doctrine)', () => {
    const { container } = renderInTable(
      <WeekGridCell
        date="2026-05-11"
        siteId="s1"
        siteName="CHU"
        cells={[makeCell({ slot: 'morning' }), makeCell({ slot: 'evening' })]}
      />,
    )
    const text = container.textContent ?? ''
    // Pas d'horaire type "08:00" ou "08h" ou "14h"
    expect(text).not.toMatch(/\d{1,2}\s*[:h]\s*\d{0,2}/)
  })

  // UX V5 — Doctrine "passé = calme visuel" (motif hachuré sobre)
  it('applique un style hachuré sobre quand la date est dans le passé', () => {
    const { container } = renderInTable(
      <WeekGridCell
        date="2026-05-10"
        siteId="s1"
        siteName="CHU"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cell = container.querySelector('[data-cell-key="s1::2026-05-10"]')
    expect(cell?.getAttribute('data-past')).toBe('true')
    const style = cell?.getAttribute('style') ?? ''
    expect(style).toContain('repeating-linear-gradient')
    // Esthétique calme : pas de barré, pas d'opacity brutale sur le contenu
    expect(style).not.toMatch(/text-decoration:\s*line-through/i)
  })

  it('n’applique PAS le style hachuré pour aujourd’hui ou le futur', () => {
    const { container: today } = renderInTable(
      <WeekGridCell
        date="2026-05-13"
        siteId="s1"
        siteName="CHU"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cellToday = today.querySelector('[data-cell-key="s1::2026-05-13"]')
    expect(cellToday?.getAttribute('data-past')).toBe('false')
    expect(cellToday?.getAttribute('style') ?? '').not.toContain('repeating-linear-gradient')

    const { container: future } = renderInTable(
      <WeekGridCell
        date="2026-05-15"
        siteId="s1"
        siteName="CHU"
        cells={[]}
        todayIso="2026-05-13"
      />,
    )
    const cellFuture = future.querySelector('[data-cell-key="s1::2026-05-15"]')
    expect(cellFuture?.getAttribute('data-past')).toBe('false')
    expect(cellFuture?.getAttribute('style') ?? '').not.toContain('repeating-linear-gradient')
  })
})

// ----------------------------------------------------------------------------
// WeekGrid
// ----------------------------------------------------------------------------

describe('WeekGrid', () => {
  it('rend une table avec thead (Chantier + 7 colonnes Lun→Dim) et tbody', () => {
    render(<WeekGrid range={WEEK_RANGE} rows={[]} todayIso="2026-05-11" />)
    const grid = screen.getByTestId('week-grid')
    expect(grid).toBeInTheDocument()
    // 8 entêtes : Chantier + Lun..Dim (« Site » = le mot de la base, pas de Guillaume).
    expect(within(grid).getByText(/^chantier$/i)).toBeInTheDocument()
    for (const label of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) {
      expect(within(grid).getByText(label)).toBeInTheDocument()
    }
  })

  it('affiche le site + le contrat dans la cellule de gauche', () => {
    const row = makeSiteRow({ site_name: 'CHU Régional', contract_name: 'Santé Centre' })
    render(<WeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />)
    expect(screen.getByText('CHU Régional')).toBeInTheDocument()
    expect(screen.getByText('Santé Centre')).toBeInTheDocument()
  })

  it('met en évidence la colonne du jour courant (data-today=true)', () => {
    render(<WeekGrid range={WEEK_RANGE} rows={[]} todayIso="2026-05-13" />)
    const grid = screen.getByTestId('week-grid')
    const todayHeader = grid.querySelector('[data-date="2026-05-13"]')
    expect(todayHeader?.getAttribute('data-today')).toBe('true')
    const otherHeader = grid.querySelector('[data-date="2026-05-11"]')
    expect(otherHeader?.getAttribute('data-today')).toBe('false')
  })

  it('rend 7 cellules de jours par ligne site', () => {
    const row = makeSiteRow()
    const { container } = render(
      <WeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />,
    )
    const cells = container.querySelectorAll('[data-slot="week-grid-cell"]')
    expect(cells.length).toBe(7)
  })
})

// ----------------------------------------------------------------------------
// CellDrawer — event delegation
// ----------------------------------------------------------------------------

describe('CellDrawer', () => {
  it('ouvre le drawer au click d’une cellule affectée et liste la mission', () => {
    const days = emptyDays()
    days['2026-05-11'] = [
      makeCell({
        id: 'i-1',
        mission_name: 'Nettoyage hall',
        slot: 'morning',
        assigned_team_id: 't-alpha',
        assigned_team_name: 'Alpha',
        assigned_team_color: 'sky',
    planned_start: null,
    planned_end: null,
      }),
    ]
    const row = makeSiteRow({ days })

    render(
      <CellDrawer rows={[row]} teams={[]} todayIso="2026-05-11">
        <WeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />
      </CellDrawer>,
    )

    fireEvent.click(screen.getByTestId('week-cell-site-1-2026-05-11'))
    expect(screen.getByTestId('drawer-intervention-i-1')).toBeInTheDocument()
    expect(screen.getByText('Nettoyage hall')).toBeInTheDocument()
    // V6.1 : le drawer affiche l'HEURE de prestation (ancrage canonique 7h pour
    // le matin quand pas d'heure précise), JAMAIS « créneau matin ».
    expect(screen.getByText('7h')).toBeInTheDocument()
    expect(screen.queryByText(/créneau/i)).not.toBeInTheDocument()
  })

  it('affiche "Non-affecté" dans le drawer pour une intervention sans équipe', () => {
    const days = emptyDays()
    days['2026-05-11'] = [
      makeCell({
        id: 'i-2',
        mission_name: 'Inspection',
        assigned_team_id: null,
        assigned_team_name: null,
        assigned_team_color: null,
    planned_start: null,
    planned_end: null,
      }),
    ]
    const row = makeSiteRow({ days })

    render(
      <CellDrawer rows={[row]} teams={[]} todayIso="2026-05-11">
        <WeekGrid range={WEEK_RANGE} rows={[row]} todayIso="2026-05-11" />
      </CellDrawer>,
    )

    fireEvent.click(screen.getByTestId('week-cell-site-1-2026-05-11'))
    // "Non-affecté" apparaît à la fois dans la cellule cliquée et dans le drawer
    // — on vérifie qu'il y a au moins une instance et que le panneau de
    // détail de l'intervention est bien ouvert.
    expect(screen.getAllByText(/non-affecté/i).length).toBeGreaterThan(0)
    expect(screen.getByTestId('drawer-intervention-i-2')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------
// PlanningGrid — ÉCHELLE MOIS (PL6-R2)
// ----------------------------------------------------------------------------
//
// Le mois entre dans la MÊME grille. Contrat R2 :
//   - un jour RÉEL ouvre le tiroir sur place → il porte [data-cell-trigger] avec
//     la clé `siteId::date` (la même mécanique de délégation que la semaine) ;
//   - un jour SEULEMENT projeté n'ouvre pas de faux tiroir et ne redirige pas en
//     silence → il porte [data-projected-trigger] (l'état « Roulement prévu ») ;
//   - la couverture du jour s'appelle « Couverture prévue », jamais « Présents ».

function makeDayFacts(overrides: Partial<DayFacts> = {}): DayFacts {
  return {
    expected: 0,
    done: 0,
    kept: 0,
    projected: 0,
    closed: false,
    hasException: false,
    cycleCovers: false,
    ...overrides,
  }
}

const MONTH_RANGE: WeekRange = {
  weekStart: '2026-05-01',
  weekEnd: '2026-05-03',
  weekNumber: 0,
  year: 2026,
}

describe('PlanningGrid — échelle mois', () => {
  const monthRows: MonthRow[] = [
    {
      siteId: 'site-x',
      siteName: 'Discount',
      clientName: 'Pointière',
      days: {
        '2026-05-01': makeDayFacts({ expected: 2 }), // RÉEL
        '2026-05-02': makeDayFacts({ projected: 1 }), // PROJETÉ seul
        '2026-05-03': makeDayFacts(), // vide
      },
    },
  ]

  it('un jour réel porte le déclencheur du MÊME tiroir (siteId::date)', () => {
    render(
      <PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={monthRows} todayIso="2026-05-01" />,
    )
    const grid = screen.getByTestId('week-grid')
    const trigger = grid.querySelector('[data-cell-trigger="true"][data-cell-key="site-x::2026-05-01"]')
    expect(trigger).not.toBeNull()
  })

  it("un jour seulement projeté n'ouvre pas de faux tiroir : il ouvre « Roulement prévu »", () => {
    render(
      <PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={monthRows} todayIso="2026-05-01" />,
    )
    const grid = screen.getByTestId('week-grid')
    // Pas de déclencheur de tiroir d'intervention sur le jour projeté…
    expect(grid.querySelector('[data-cell-trigger="true"][data-cell-key="site-x::2026-05-02"]')).toBeNull()
    // …mais un déclencheur d'état « Roulement prévu ».
    const projected = grid.querySelector('[data-projected-trigger="true"][data-date="2026-05-02"]')
    expect(projected).not.toBeNull()
    expect(projected?.getAttribute('data-site-id')).toBe('site-x')
  })

  it('nomme la couverture « Couverture prévue », jamais « Présents »', () => {
    render(
      <PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={monthRows} todayIso="2026-05-01" />,
    )
    const grid = screen.getByTestId('week-grid')
    expect(within(grid).getByText(/couverture prévue/i)).toBeInTheDocument()
    expect(within(grid).queryByText(/^présents$/i)).toBeNull()
  })

  // R3 — un « 0 » rouge ne signale QU'UN VRAI trou (roulement attendu, personne).
  // Un jour vide sans planning attendu reste NEUTRE : un calendrier vide n'est pas
  // un problème. C'est une correction de SENS, pas seulement de couleur.
  it('ne met en rouge que les vrais trous de couverture, pas chaque jour vide', () => {
    const rowsHoleVsEmpty: MonthRow[] = [
      {
        siteId: 'site-h',
        siteName: 'Discount',
        clientName: 'Pointière',
        days: {
          '2026-05-01': makeDayFacts({ cycleCovers: true }), // TROU : roulement attendait, 0 personne
          '2026-05-02': makeDayFacts(), // vide neutre : rien n'était attendu
          '2026-05-03': makeDayFacts({ expected: 1 }), // couvert
        },
      },
    ]
    render(
      <PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={rowsHoleVsEmpty} todayIso="2026-05-01" />,
    )
    const foot = screen.getByTestId('week-grid').querySelector('tfoot')!
    const tds = foot.querySelectorAll('td')
    // td[0] = 1er mai (trou) → rouge ; td[1] = 2 mai (vide neutre) → PAS rouge.
    expect(tds[0].className).toMatch(/rose/)
    expect(tds[1].className).not.toMatch(/rose/)
  })
})

// ----------------------------------------------------------------------------
// TESTS FONCTIONNELS (Vincent, R4) — le comportement métier, pas le vocabulaire.
// « Ce sont eux qui éviteront que le planning régresse. »
// ----------------------------------------------------------------------------

describe('PlanningGrid mois — les états se VOIENT', () => {
  const facts: MonthRow[] = [
    {
      siteId: 'site-f',
      siteName: 'Lycée',
      clientName: 'Païta',
      days: {
        '2026-05-01': makeDayFacts({ closed: true }), // fermé, rien de prévu
        '2026-05-02': makeDayFacts({ closed: true, expected: 2 }), // CONFLIT
        '2026-05-03': makeDayFacts({ expected: 1 }),
      },
    },
  ]

  it('un jour fermé est bleu — information, pas alarme', () => {
    render(<PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={facts} todayIso="2026-05-03" />)
    const td = screen.getByTestId('week-grid').querySelector('td[data-date="2026-05-01"]')!
    expect(td.className).toMatch(/bg-sky/)
    expect(td.className).not.toMatch(/bg-rose/)
  })

  it('fermé ET du monde prévu = conflit : rouge, et le chiffre crie (2!)', () => {
    render(<PlanningGrid scale="month" range={MONTH_RANGE} rows={[]} monthRows={facts} todayIso="2026-05-03" />)
    const td = screen.getByTestId('week-grid').querySelector('td[data-date="2026-05-02"]')!
    expect(td.className).toMatch(/bg-rose/)
    expect(td.textContent).toContain('2!')
  })
})

describe('PlanningGrid mois — le clic ouvre le BON tiroir', () => {
  const realDay = '2026-05-01'
  const projDay = '2026-05-02'
  const siteRows: SiteRow[] = [
    {
      site_id: 'site-x',
      site_name: 'Discount',
      client_name: 'Pointière',
      contract_id: 'c-1',
      contract_name: 'Contrat Nettoyage',
      days: { [realDay]: [makeCell({ site_id: 'site-x', scheduled_for: realDay, mission_name: 'Entretien magasin' })] },
    } as SiteRow,
  ]
  const monthRows: MonthRow[] = [
    {
      siteId: 'site-x',
      siteName: 'Discount',
      clientName: 'Pointière',
      days: {
        [realDay]: makeDayFacts({ expected: 1 }),
        [projDay]: makeDayFacts({ projected: 1 }),
        '2026-05-03': makeDayFacts(),
      },
    },
  ]

  function renderMonthWithDrawer() {
    return render(
      <CellDrawer rows={siteRows} teams={[]} todayIso={realDay}>
        <PlanningGrid scale="month" range={MONTH_RANGE} rows={siteRows} monthRows={monthRows} todayIso={realDay} />
      </CellDrawer>,
    )
  }

  it("un jour RÉEL ouvre le tiroir d'intervention, sur place", () => {
    renderMonthWithDrawer()
    fireEvent.click(
      document.querySelector(`[data-cell-trigger="true"][data-cell-key="site-x::${realDay}"]`)!,
    )
    // Le MÊME tiroir que la semaine : l'intervention est là, avec ses gestes.
    expect(screen.getByText('Entretien magasin')).toBeInTheDocument()
    expect(screen.queryByText('Roulement prévu')).not.toBeInTheDocument()
  })

  it('un jour PROJETÉ ouvre « Roulement prévu » — jamais un faux tiroir d’intervention', () => {
    renderMonthWithDrawer()
    fireEvent.click(
      document.querySelector(`[data-projected-trigger="true"][data-date="${projDay}"]`)!,
    )
    expect(screen.getByText('Roulement prévu')).toBeInTheDocument()
    expect(screen.getByText('Aucune intervention créée.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configurer le roulement/ })).toHaveAttribute(
      'href',
      '/sites/site-x/roulements',
    )
    // Rien de matérialisé : pas de carte d'intervention.
    expect(screen.queryByText('Entretien magasin')).not.toBeInTheDocument()
  })
})
