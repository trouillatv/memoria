// PL3a — le signal de fermeture DANS la vue existante.
//
// Ce fichier est un fichier de NON-RÉGRESSION autant que de fonctionnalité.
// Les critères qu'il verrouille, un par un :
//
//  • sans fermeture → l'écran est STRICTEMENT identique à avant ;
//  • avec fermeture → le badge apparaît, et il ne CAPTURE AUCUN événement de
//    pointeur (sinon un clic dessus démarrerait un drag fantôme : le <td> est
//    draggable ET droppable) ;
//  • la cellule reste draggable et droppable avec le signal affiché ;
//  • le drawer explique le conflit ET dit qu'aucune décision n'a été prise ;
//  • aucun geste n'est proposé (PL3a constate, il n'agit pas).

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'

// Mêmes neutralisations que week-grid.test.tsx : CellDrawer tire useRouter()
// (via EditInterventionTimeDialog) et, transitivement, un guard `server-only`.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('server-only', () => ({}))

import { WeekGridCell } from '@/app/(dashboard)/semaine/WeekGridCell'
import { CellDrawer } from '@/app/(dashboard)/semaine/CellDrawer'
import type { SiteRow, WeekInterventionCell } from '@/lib/db/week-planning'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { ProjectableClosure } from '@/lib/planning/closures'

function makeCell(overrides: Partial<WeekInterventionCell> = {}): WeekInterventionCell {
  return {
    id: 'i-1',
    mission_id: 'm-1',
    mission_name: 'Entretien du magasin',
    site_id: 'site-1',
    site_name: 'Pointière',
    contract_id: 'c-1',
    contract_name: 'Contrat Discount',
    scheduled_for: '2026-07-14',
    slot: 'morning',
    status: 'planned',
    skipped_at: null,
    assigned_team_id: 't-1',
    assigned_team_name: 'Alpha',
    assigned_team_color: 'sky',
    planned_start: null,
    planned_end: null,
    ...overrides,
  }
}

const CONFLICT: ClosureConflict = {
  closure: {
    id: 'cl-1',
    siteId: 'site-1',
    reasonKind: 'client',
    reason: 'Magasin fermé',
    startsOn: '2026-07-14',
    endsOn: '2026-07-14',
    defaultResolution: 'none',
  },
  expectedCount: 1,
}

/** Le <td> doit vivre dans un <table> ET dans un DndContext (il est draggable). */
function renderCell(ui: React.ReactElement) {
  return render(
    <DndContext>
      <table>
        <tbody>
          <tr>{ui}</tr>
        </tbody>
      </table>
    </DndContext>,
  )
}

describe('WeekGridCell — sans fermeture, RIEN ne change', () => {
  it('aucun badge de conflit quand la prop est absente', () => {
    renderCell(<WeekGridCell date="2026-07-14" siteId="site-1" siteName="Pointière" cells={[makeCell()]} />)
    expect(screen.queryByTestId('cell-closure-conflict')).toBeNull()
  })

  it('la cellule reste draggable et droppable (le DnD n’est pas touché)', () => {
    const { container } = renderCell(
      <WeekGridCell date="2026-07-14" siteId="site-1" siteName="Pointière" cells={[makeCell()]} />,
    )
    const td = container.querySelector('[data-slot="week-grid-cell"]')
    expect(td).not.toBeNull()
    // dnd-kit pose ses attributs de draggable sur le <td> lui-même.
    expect(td!.getAttribute('role')).toBe('button') // attributes de useDraggable
  })
})

describe('WeekGridCell — avec fermeture, un badge NON INTERACTIF', () => {
  it('le badge apparaît et dit POURQUOI', () => {
    renderCell(
      <WeekGridCell
        date="2026-07-14"
        siteId="site-1"
        siteName="Pointière"
        cells={[makeCell()]}
        conflict={CONFLICT}
      />,
    )
    const badge = screen.getByTestId('cell-closure-conflict')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('title')).toContain('Fermeture du client')
    expect(badge.getAttribute('title')).toContain('Magasin fermé')
  })

  it('LE POINT CRITIQUE : le badge ne capture AUCUN événement de pointeur', () => {
    // Sinon un clic dessus démarrerait un drag fantôme (le <td> est draggable).
    renderCell(
      <WeekGridCell
        date="2026-07-14"
        siteId="site-1"
        siteName="Pointière"
        cells={[makeCell()]}
        conflict={CONFLICT}
      />,
    )
    expect(screen.getByTestId('cell-closure-conflict').className).toContain('pointer-events-none')
  })

  it('la cellule reste draggable ET droppable avec le signal affiché', () => {
    const { container } = renderCell(
      <WeekGridCell
        date="2026-07-14"
        siteId="site-1"
        siteName="Pointière"
        cells={[makeCell()]}
        conflict={CONFLICT}
      />,
    )
    const td = container.querySelector('[data-slot="week-grid-cell"]')
    expect(td!.getAttribute('role')).toBe('button')
    expect(screen.getByTestId('cell-closure-conflict')).toBeInTheDocument()
  })

  it('aucun bouton, aucun geste : PL3a CONSTATE, il n’agit pas', () => {
    renderCell(
      <WeekGridCell
        date="2026-07-14"
        siteId="site-1"
        siteName="Pointière"
        cells={[makeCell()]}
        conflict={CONFLICT}
      />,
    )
    const badge = screen.getByTestId('cell-closure-conflict')
    expect(badge.tagName.toLowerCase()).toBe('span') // pas un <button>
    expect(badge.querySelector('button')).toBeNull()
  })
})

// ── L'aperçu ────────────────────────────────────────────────────────────────

function makeRow(): SiteRow {
  const days: Record<string, WeekInterventionCell[]> = {}
  for (let i = 13; i <= 19; i++) days[`2026-07-${i}`] = []
  days['2026-07-14'] = [makeCell()]
  return {
    site_id: 'site-1',
    site_name: 'Pointière',
    client_name: 'Discount',
    contract_id: 'c-1',
    contract_name: 'Contrat Discount',
    days,
  }
}

/** Le drawer s'ouvre par délégation de clic sur [data-cell-trigger]. */
function renderDrawer(conflictsBySite?: Record<string, Record<string, ClosureConflict>>) {
  return render(
    <CellDrawer rows={[makeRow()]} teams={[]} todayIso="2026-07-13" conflictsBySite={conflictsBySite}>
      <button type="button" data-cell-trigger="true" data-cell-key="site-1::2026-07-14">
        ouvrir
      </button>
    </CellDrawer>,
  )
}

describe('CellDrawer — le bloc « Conflit de planning »', () => {
  it('sans conflit → aucune section (silence positif)', () => {
    const { getByText } = renderDrawer(undefined)
    fireEvent.click(getByText('ouvrir'))
    expect(screen.queryByTestId('drawer-closure-conflict')).toBeNull()
  })

  it('avec conflit → explique le POURQUOI, et rien n’a été modifié', () => {
    const { getByText } = renderDrawer({ 'site-1': { '2026-07-14': CONFLICT } })
    fireEvent.click(getByText('ouvrir'))

    const section = screen.getByTestId('drawer-closure-conflict')
    expect(section).toBeInTheDocument()
    expect(section.textContent).toContain('Le site est déclaré fermé')
    expect(section.textContent).toContain('fermeture du client')
    expect(section.textContent).toContain('Magasin fermé')
    expect(section.textContent).toContain('reste planifiée')
    // PL3a disait « aucune décision n'a encore été prise » parce qu'aucun geste
    // n'existait. PL3b LES DONNE (« Que fait-on ? ») : la phrase serait fausse.
    // Ce qui reste vrai, et qu'il faut continuer de dire : rien n'a bougé.
    expect(section.textContent).toContain('Rien n’a été modifié')
    expect(section.textContent).toContain('Que fait-on')
  })

  it('PL3a ne propose AUCUN geste dans le bloc de conflit', () => {
    const { getByText } = renderDrawer({ 'site-1': { '2026-07-14': CONFLICT } })
    fireEvent.click(getByText('ouvrir'))
    const section = screen.getByTestId('drawer-closure-conflict')
    expect(section.querySelector('button')).toBeNull()
    expect(section.textContent).not.toMatch(/déplacer|annuler|maintenir/i)
  })

  it('plusieurs prestations → le compte est dit au pluriel', () => {
    const { getByText } = renderDrawer({
      'site-1': { '2026-07-14': { ...CONFLICT, expectedCount: 3 } },
    })
    fireEvent.click(getByText('ouvrir'))
    expect(screen.getByTestId('drawer-closure-conflict').textContent).toContain(
      'Ces 3 interventions restent planifiées',
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// NIVEAU 1 — le CALENDRIER du chantier, avant tout conflit.
//
// Guillaume se sert des fermetures pour CONSTRUIRE son planning (vacances,
// fériés, inventaires), pas seulement pour corriger des erreurs. Une fermeture
// doit donc se voir même quand aucune prestation n'est prévue — calmement.
// Le rouge reste réservé au niveau 2 : fermé ET du monde prévu.
// ─────────────────────────────────────────────────────────────────────────────

const CLOSURE: ProjectableClosure = {
  id: 'cl-9',
  siteId: 'site-1',
  reasonKind: 'holiday',
  reason: null,
  startsOn: '2026-07-14',
  endsOn: '2026-07-14',
  defaultResolution: 'none',
}

const cellWith = (props: Partial<React.ComponentProps<typeof WeekGridCell>>) => (
  <WeekGridCell date="2026-07-14" siteId="site-1" siteName="Pointière" cells={[]} {...props} />
)

describe('Niveau 1 — le jour fermé se VOIT, même sans prestation', () => {
  it('une cellule vide sur un jour fermé porte le signal de fermeture', () => {
    renderCell(cellWith({ closure: CLOSURE }))
    const mark = screen.getByTestId('cell-closure')
    expect(mark).toBeInTheDocument()
    expect(mark.getAttribute('title')).toContain('Chantier fermé')
    // Ce n'est PAS une alerte : aucun badge de conflit.
    expect(screen.queryByTestId('cell-closure-conflict')).toBeNull()
  })

  it('le signal de fermeture ne capture aucun événement de pointeur', () => {
    // Le <td> est draggable ET droppable : un signal interactif démarrerait un
    // drag fantôme.
    renderCell(cellWith({ closure: CLOSURE }))
    expect(screen.getByTestId('cell-closure').className).toContain('pointer-events-none')
  })

  it('sans fermeture, la cellule est strictement identique à avant', () => {
    renderCell(cellWith({}))
    expect(screen.queryByTestId('cell-closure')).toBeNull()
    expect(screen.queryByTestId('cell-closure-conflict')).toBeNull()
  })

  it('NIVEAU 2 prime : fermé + prestation prévue → le conflit, pas deux signaux', () => {
    renderCell(cellWith({ cells: [makeCell()], closure: CONFLICT.closure, conflict: CONFLICT }))
    expect(screen.getByTestId('cell-closure-conflict')).toBeInTheDocument()
    // On ne dit pas deux fois la même chose : le signal calme s'efface.
    expect(screen.queryByTestId('cell-closure')).toBeNull()
  })
})
