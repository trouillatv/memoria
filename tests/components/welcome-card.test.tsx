import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WelcomeCard } from '@/app/(dashboard)/dashboard/WelcomeCard'
import type { OnboardingProgress } from '@/lib/db/onboarding'

function makeProgress(p: Partial<Omit<OnboardingProgress, 'allDone'>> = {}): OnboardingProgress {
  const hasSite = p.hasSite ?? false
  const hasMeeting = p.hasMeeting ?? false
  const hasAction = p.hasAction ?? false
  return { hasSite, hasMeeting, hasAction, allDone: hasSite && hasMeeting && hasAction }
}

describe('WelcomeCard', () => {
  it('renders 3 steps when nothing is done, with step 1 highlighted as next', () => {
    const { container } = render(<WelcomeCard progress={makeProgress()} />)

    const items = container.querySelectorAll('li[data-step]')
    expect(items).toHaveLength(3)

    expect(
      screen.getByText(/Trois étapes pour lancer la mémoire de votre chantier/i),
    ).toBeInTheDocument()

    expect(container.querySelector('li[data-step="hasSite"]')?.getAttribute('data-state')).toBe('next')
    expect(container.querySelector('li[data-step="hasMeeting"]')?.getAttribute('data-state')).toBe('future')
    expect(container.querySelector('li[data-step="hasAction"]')?.getAttribute('data-state')).toBe('future')

    // Only one CTA visible (on the next step)
    const ctas = container.querySelectorAll('a[href]')
    expect(ctas).toHaveLength(1)
    expect(ctas[0].getAttribute('href')).toBe('/sites')
    expect(ctas[0].textContent).toContain('Aller aux chantiers')
  })

  it('marks step 1 done when hasSite=true and highlights step 2 as next', () => {
    const { container } = render(<WelcomeCard progress={makeProgress({ hasSite: true })} />)

    expect(container.querySelector('li[data-step="hasSite"]')?.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('li[data-step="hasMeeting"]')?.getAttribute('data-state')).toBe('next')
    expect(container.querySelector('li[data-step="hasAction"]')?.getAttribute('data-state')).toBe('future')

    expect(screen.getByTestId('step-1-done')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 3 étapes franchies/i)).toBeInTheDocument()
  })

  it('marks steps 1+2 done when site and meeting exist, highlights step 3', () => {
    const { container } = render(
      <WelcomeCard progress={makeProgress({ hasSite: true, hasMeeting: true })} />,
    )

    expect(container.querySelector('li[data-step="hasSite"]')?.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('li[data-step="hasMeeting"]')?.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('li[data-step="hasAction"]')?.getAttribute('data-state')).toBe('next')

    expect(screen.getByText(/2 \/ 3 étapes franchies/i)).toBeInTheDocument()
  })

  it('shows the CTA arrow only on the next step — never on done or future', () => {
    const { container } = render(<WelcomeCard progress={makeProgress({ hasSite: true })} />)

    // Done step: no CTA link inside
    expect(container.querySelector('li[data-step="hasSite"]')?.querySelector('a[href]')).toBeNull()

    // Next step: one CTA link
    const nextStep = container.querySelector('li[data-step="hasMeeting"]')
    expect(nextStep?.querySelector('a[href]')).not.toBeNull()
    expect(nextStep?.querySelector('a[href]')?.textContent).toContain('Aller aux réunions')

    // Future step: no CTA link
    expect(container.querySelector('li[data-step="hasAction"]')?.querySelector('a[href]')).toBeNull()
  })

  it('description copy changes between zero progress and partial progress', () => {
    const { rerender } = render(<WelcomeCard progress={makeProgress()} />)
    expect(
      screen.getByText(/Trois étapes pour lancer la mémoire de votre chantier/i),
    ).toBeInTheDocument()

    rerender(<WelcomeCard progress={makeProgress({ hasSite: true })} />)
    expect(screen.getByText(/1 \/ 3 étapes franchies/i)).toBeInTheDocument()
    expect(screen.getByText(/Plus que 2 pour lancer la boucle/i)).toBeInTheDocument()
  })
})
