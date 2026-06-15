import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecurrenceModal } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/RecurrenceModal'
import type { DbInterventionTemplate } from '@/types/db'

// Mock the server actions — we just want to verify shape of calls.
const createRecurrenceMock = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  templateId: 'tpl-1',
}))
const updateRecurrenceMock = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  templateId: 'tpl-1',
}))
vi.mock('@/app/(dashboard)/contracts/[id]/recurrences-actions', () => ({
  createRecurrenceAction: (input: unknown) => createRecurrenceMock(input),
  updateRecurrenceAction: (input: unknown) => updateRecurrenceMock(input),
}))

// next/navigation is referenced via useRouter().refresh()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// sonner.toast is referenced — stub it.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const baseProps = {
  missionId: '11111111-1111-1111-1111-111111111111',
  missionName: 'Bionettoyage sanitaires RDC',
  contractId: '22222222-2222-2222-2222-222222222222',
  open: true,
  onClose: vi.fn(),
}

// Les heures (créneaux horaires) sont requises pour valider le submit depuis
// que Matin/Après-midi/Soir a été retiré (décision 2026-06-15).
function fillValidTimes(start = '07:00', end = '09:00') {
  fireEvent.change(screen.getByLabelText('Début'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('Fin'), { target: { value: end } })
}

describe('RecurrenceModal — initial render', () => {
  beforeEach(() => {
    createRecurrenceMock.mockClear()
  })

  it('renders title "Quand cette mission revient-elle ?"', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.getByText(/quand cette mission revient-elle/i)).toBeInTheDocument()
  })

  it('shows the contextual mission name (Q1 read-only)', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.getByText('Bionettoyage sanitaires RDC')).toBeInTheDocument()
  })

  it('renders Q2 with 4 frequency options', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.getByLabelText(/tous les jours/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/du lundi au vendredi/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/une fois par semaine/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/une fois par mois/i)).toBeInTheDocument()
  })

  it('renders Q3 créneaux horaires (Début / Fin) — plus de chips Matin/Après-midi/Soir', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.getByTestId('q-time')).toBeInTheDocument()
    expect(screen.getByLabelText('Début')).toBeInTheDocument()
    expect(screen.getByLabelText('Fin')).toBeInTheDocument()
    // Les anciens chips de créneau nommé n'existent plus.
    expect(screen.queryByTestId('slot-chip-morning')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Matin$/)).not.toBeInTheDocument()
  })

  it('renders Q4 date input "À partir de quand ?"', () => {
    render(<RecurrenceModal {...baseProps} />)
    const dateInput = screen.getByLabelText(/à partir de quand/i) as HTMLInputElement
    expect(dateInput).toBeInTheDocument()
    expect(dateInput.type).toBe('date')
  })

  it('does NOT render day_of_week or day_of_month fields by default', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.queryByTestId('q-day-of-week')).not.toBeInTheDocument()
    expect(screen.queryByTestId('q-day-of-month')).not.toBeInTheDocument()
  })
})

describe('RecurrenceModal — conditional fields', () => {
  it('shows "Quel jour ?" when frequency=weekly is selected', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par semaine/i))
    expect(screen.getByTestId('q-day-of-week')).toBeInTheDocument()
    expect(screen.getByText(/quel jour \?/i)).toBeInTheDocument()
  })

  it('shows "Quel jour du mois ?" when frequency=monthly is selected', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par mois/i))
    expect(screen.getByTestId('q-day-of-month')).toBeInTheDocument()
    expect(screen.getByText(/quel jour du mois/i)).toBeInTheDocument()
  })

  it('hides the conditional field when switching back to daily', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par semaine/i))
    expect(screen.getByTestId('q-day-of-week')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/tous les jours/i))
    expect(screen.queryByTestId('q-day-of-week')).not.toBeInTheDocument()
  })
})

describe('RecurrenceModal — créneaux horaires', () => {
  beforeEach(() => {
    createRecurrenceMock.mockClear()
  })

  it('garde le submit désactivé tant que les heures sont absentes ou incohérentes', () => {
    render(<RecurrenceModal {...baseProps} />)
    const submit = screen.getByTestId('recurrence-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true) // aucune heure saisie
    fillValidTimes('09:00', '08:00') // fin avant début
    expect(submit.disabled).toBe(true)
    fillValidTimes('08:00', '10:00')
    expect(submit.disabled).toBe(false)
  })

  it('passe les heures précises (planned_start/end) à l’action, slots vides', async () => {
    render(<RecurrenceModal {...baseProps} />)
    fillValidTimes('06:30', '08:00')
    fireEvent.click(screen.getByTestId('recurrence-submit'))

    await waitFor(() => {
      expect(createRecurrenceMock).toHaveBeenCalledTimes(1)
    })
    const arg = createRecurrenceMock.mock.calls[0]?.[0] as unknown as {
      slots: string[]
      frequency: string
      mission_id: string
      planned_start_hhmm: string
      planned_end_hhmm: string
    }
    expect(arg.frequency).toBe('daily')
    expect(arg.mission_id).toBe(baseProps.missionId)
    expect(arg.planned_start_hhmm).toBe('06:30')
    expect(arg.planned_end_hhmm).toBe('08:00')
    expect(arg.slots).toEqual([])
  })
})

describe('RecurrenceModal — submit validation', () => {
  beforeEach(() => {
    createRecurrenceMock.mockClear()
  })

  it('disables submit when frequency=weekly and no day_of_week chosen', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par semaine/i))
    const submit = screen.getByTestId('recurrence-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('enables submit once day_of_week is chosen for weekly', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par semaine/i))
    fillValidTimes()
    const select = screen.getByTestId('q-day-of-week').querySelector('select')!
    fireEvent.change(select, { target: { value: '2' } })
    const submit = screen.getByTestId('recurrence-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('disables submit for monthly until day_of_month is provided', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par mois/i))
    fillValidTimes()
    const submit = screen.getByTestId('recurrence-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const input = screen.getByTestId('q-day-of-month').querySelector('input')!
    fireEvent.change(input, { target: { value: '15' } })
    expect(submit.disabled).toBe(false)
  })

  it('does not render when open=false', () => {
    render(<RecurrenceModal {...baseProps} open={false} />)
    expect(screen.queryByText(/quand cette mission revient-elle/i)).not.toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------
// Slice 6.5 — mode edition (prop `template` presente)
// ----------------------------------------------------------------------------

const baseTemplate: DbInterventionTemplate = {
  id: 'tpl-existing-1',
  mission_id: baseProps.missionId,
  title: 'Bionettoyage 2x/jour',
  description: null,
  frequency: 'weekly',
  slots: ['morning', 'evening'],
  day_of_week: 2,
  day_of_month: null,
  planned_start_hhmm: '07:00',
  planned_end_hhmm: '09:00',
  starts_on: '2026-05-12',
  ends_on: null,
  active: true,
  created_at: '2026-05-01T00:00:00.000Z',
  created_by: null,
  deleted_at: null,
}

describe('RecurrenceModal — mode edition (Slice 6.5)', () => {
  beforeEach(() => {
    createRecurrenceMock.mockClear()
    updateRecurrenceMock.mockClear()
  })

  it('affiche le titre "Modifier la récurrence" en mode edition', () => {
    render(<RecurrenceModal {...baseProps} template={baseTemplate} />)
    expect(screen.getByText(/modifier la récurrence/i)).toBeInTheDocument()
    expect(screen.queryByText(/quand cette mission revient-elle/i)).not.toBeInTheDocument()
  })

  it('preremplit frequency, day_of_week, heures, starts_on depuis le template', () => {
    render(<RecurrenceModal {...baseProps} template={baseTemplate} />)
    // frequency=weekly → radio weekly coche + selecteur day_of_week visible
    const weeklyRadio = screen.getByLabelText(/une fois par semaine/i) as HTMLInputElement
    expect(weeklyRadio.checked).toBe(true)

    const select = screen.getByTestId('q-day-of-week').querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('2')

    // créneaux horaires prereremplis depuis planned_start/end_hhmm
    expect((screen.getByLabelText('Début') as HTMLInputElement).value).toBe('07:00')
    expect((screen.getByLabelText('Fin') as HTMLInputElement).value).toBe('09:00')

    // starts_on prerempli
    const dateInput = screen.getByLabelText(/à partir de quand/i) as HTMLInputElement
    expect(dateInput.value).toBe('2026-05-12')
  })

  it('affiche le label de bouton "Enregistrer les modifications" en mode edition', () => {
    render(<RecurrenceModal {...baseProps} template={baseTemplate} />)
    const submit = screen.getByTestId('recurrence-submit')
    expect(submit.textContent).toMatch(/enregistrer les modifications/i)
  })

  it('submit appelle updateRecurrenceAction (pas createRecurrenceAction) avec templateId', async () => {
    render(<RecurrenceModal {...baseProps} template={baseTemplate} />)
    fireEvent.click(screen.getByTestId('recurrence-submit'))

    await waitFor(() => {
      expect(updateRecurrenceMock).toHaveBeenCalledTimes(1)
    })
    expect(createRecurrenceMock).not.toHaveBeenCalled()

    const arg = updateRecurrenceMock.mock.calls[0]?.[0] as unknown as {
      templateId: string
      frequency: string
      day_of_week: number | null
      slots: string[]
      planned_start_hhmm: string
      planned_end_hhmm: string
      starts_on: string
      contract_id: string
    }
    expect(arg.templateId).toBe(baseTemplate.id)
    expect(arg.frequency).toBe('weekly')
    expect(arg.day_of_week).toBe(2)
    expect(arg.slots).toEqual([])
    expect(arg.planned_start_hhmm).toBe('07:00')
    expect(arg.planned_end_hhmm).toBe('09:00')
    expect(arg.starts_on).toBe('2026-05-12')
    expect(arg.contract_id).toBe(baseProps.contractId)
  })

  it('en mode creation (sans template), submit appelle createRecurrenceAction', async () => {
    render(<RecurrenceModal {...baseProps} />)
    fillValidTimes()
    fireEvent.click(screen.getByTestId('recurrence-submit'))

    await waitFor(() => {
      expect(createRecurrenceMock).toHaveBeenCalledTimes(1)
    })
    expect(updateRecurrenceMock).not.toHaveBeenCalled()
  })
})
