import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecurrenceModal } from '@/app/(dashboard)/contracts/[id]/missions/[missionId]/edit/RecurrenceModal'

// Mock the server action — we just want to verify shape of calls.
const createRecurrenceMock = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  templateId: 'tpl-1',
}))
vi.mock('@/app/(dashboard)/contracts/[id]/recurrences-actions', () => ({
  createRecurrenceAction: (input: unknown) => createRecurrenceMock(input),
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

  it('renders Q3 chips Matin / Après-midi / Soir', () => {
    render(<RecurrenceModal {...baseProps} />)
    expect(screen.getByTestId('slot-chip-morning')).toBeInTheDocument()
    expect(screen.getByTestId('slot-chip-afternoon')).toBeInTheDocument()
    expect(screen.getByTestId('slot-chip-evening')).toBeInTheDocument()
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

describe('RecurrenceModal — slots multi-select', () => {
  beforeEach(() => {
    createRecurrenceMock.mockClear()
  })

  it('toggles aria-pressed when clicking a slot chip', () => {
    render(<RecurrenceModal {...baseProps} />)
    const chip = screen.getByTestId('slot-chip-morning')
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('passes selected slots to the server action on submit', async () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByTestId('slot-chip-morning'))
    fireEvent.click(screen.getByTestId('slot-chip-evening'))
    fireEvent.click(screen.getByTestId('recurrence-submit'))

    await waitFor(() => {
      expect(createRecurrenceMock).toHaveBeenCalledTimes(1)
    })
    const arg = createRecurrenceMock.mock.calls[0]?.[0] as unknown as {
      slots: string[]
      frequency: string
      mission_id: string
    }
    expect(arg.frequency).toBe('daily')
    expect(arg.mission_id).toBe(baseProps.missionId)
    expect(arg.slots.sort()).toEqual(['evening', 'morning'])
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
    const select = screen.getByTestId('q-day-of-week').querySelector('select')!
    fireEvent.change(select, { target: { value: '2' } })
    const submit = screen.getByTestId('recurrence-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('disables submit for monthly until day_of_month is provided', () => {
    render(<RecurrenceModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/une fois par mois/i))
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
