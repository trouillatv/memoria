import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WelcomeCard } from '@/app/(dashboard)/dashboard/WelcomeCard'
import type { OnboardingProgress } from '@/lib/db/onboarding'

function makeProgress(p: Partial<Omit<OnboardingProgress, 'allDone'>> = {}): OnboardingProgress {
  const hasImportedTender = p.hasImportedTender ?? false
  const hasCuratedEngagement = p.hasCuratedEngagement ?? false
  const hasActiveContract = p.hasActiveContract ?? false
  const hasMission = p.hasMission ?? false
  return {
    hasImportedTender,
    hasCuratedEngagement,
    hasActiveContract,
    hasMission,
    allDone:
      hasImportedTender && hasCuratedEngagement && hasActiveContract && hasMission,
  }
}

describe('WelcomeCard', () => {
  it('renders 4 steps when nothing is done, with step 1 highlighted as next', () => {
    const { container } = render(<WelcomeCard progress={makeProgress()} />)

    // Four steps total
    const items = container.querySelectorAll('li[data-step]')
    expect(items).toHaveLength(4)

    // Description shows the 0-progress copy
    expect(
      screen.getByText(/Quatre étapes pour transformer un AO/i),
    ).toBeInTheDocument()

    // Step 1 is the "next" one
    const step1 = container.querySelector('li[data-step="hasImportedTender"]')
    expect(step1?.getAttribute('data-state')).toBe('next')

    // Step 2/3/4 are "future"
    expect(
      container
        .querySelector('li[data-step="hasCuratedEngagement"]')
        ?.getAttribute('data-state'),
    ).toBe('future')
    expect(
      container
        .querySelector('li[data-step="hasActiveContract"]')
        ?.getAttribute('data-state'),
    ).toBe('future')
    expect(
      container
        .querySelector('li[data-step="hasMission"]')
        ?.getAttribute('data-state'),
    ).toBe('future')

    // Only one CTA visible (on the next step)
    const ctas = container.querySelectorAll('a[href]')
    expect(ctas).toHaveLength(1)
    expect(ctas[0].getAttribute('href')).toBe('/tenders')
    expect(ctas[0].textContent).toContain('Aller aux AO')
  })

  it('marks step 1 done when hasImportedTender=true and highlights step 2 as next', () => {
    const { container } = render(
      <WelcomeCard progress={makeProgress({ hasImportedTender: true })} />,
    )

    expect(
      container
        .querySelector('li[data-step="hasImportedTender"]')
        ?.getAttribute('data-state'),
    ).toBe('done')
    expect(
      container
        .querySelector('li[data-step="hasCuratedEngagement"]')
        ?.getAttribute('data-state'),
    ).toBe('next')
    expect(
      container
        .querySelector('li[data-step="hasActiveContract"]')
        ?.getAttribute('data-state'),
    ).toBe('future')

    // Check icon present on step 1
    expect(screen.getByTestId('step-1-done')).toBeInTheDocument()

    // Description reflects 1/4
    expect(screen.getByText(/1 \/ 4 étapes franchies/i)).toBeInTheDocument()
  })

  it('marks steps 1+2 done when both curated and imported, highlights step 3', () => {
    const { container } = render(
      <WelcomeCard
        progress={makeProgress({
          hasImportedTender: true,
          hasCuratedEngagement: true,
        })}
      />,
    )

    expect(
      container
        .querySelector('li[data-step="hasImportedTender"]')
        ?.getAttribute('data-state'),
    ).toBe('done')
    expect(
      container
        .querySelector('li[data-step="hasCuratedEngagement"]')
        ?.getAttribute('data-state'),
    ).toBe('done')
    expect(
      container
        .querySelector('li[data-step="hasActiveContract"]')
        ?.getAttribute('data-state'),
    ).toBe('next')

    expect(screen.getByText(/2 \/ 4 étapes franchies/i)).toBeInTheDocument()
  })

  it('renders step 3 as done when hasActiveContract is true (defensive render)', () => {
    // Note: in production this state implies the WelcomeCard is hidden by the
    // page wrapper. Still, the component must render coherently if invoked.
    const { container } = render(
      <WelcomeCard
        progress={makeProgress({
          hasImportedTender: true,
          hasCuratedEngagement: true,
          hasActiveContract: true,
        })}
      />,
    )

    expect(
      container
        .querySelector('li[data-step="hasActiveContract"]')
        ?.getAttribute('data-state'),
    ).toBe('done')
    expect(
      container
        .querySelector('li[data-step="hasMission"]')
        ?.getAttribute('data-state'),
    ).toBe('next')
  })

  it('shows the CTA arrow only on the next step — never on done or future', () => {
    const { container } = render(
      <WelcomeCard progress={makeProgress({ hasImportedTender: true })} />,
    )

    // Done step: no CTA link inside
    const doneStep = container.querySelector('li[data-step="hasImportedTender"]')
    expect(doneStep?.querySelector('a[href]')).toBeNull()

    // Next step: one CTA link
    const nextStep = container.querySelector(
      'li[data-step="hasCuratedEngagement"]',
    )
    expect(nextStep?.querySelector('a[href]')).not.toBeNull()
    expect(nextStep?.querySelector('a[href]')?.textContent).toContain('Voir les AO')

    // Future steps: no CTA link
    expect(
      container
        .querySelector('li[data-step="hasActiveContract"]')
        ?.querySelector('a[href]'),
    ).toBeNull()
    expect(
      container
        .querySelector('li[data-step="hasMission"]')
        ?.querySelector('a[href]'),
    ).toBeNull()
  })

  it('description copy changes between zero progress and partial progress', () => {
    const { rerender } = render(<WelcomeCard progress={makeProgress()} />)
    expect(
      screen.getByText(/Quatre étapes pour transformer un AO/i),
    ).toBeInTheDocument()

    rerender(
      <WelcomeCard progress={makeProgress({ hasImportedTender: true })} />,
    )
    expect(screen.getByText(/1 \/ 4 étapes franchies/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Plus que 3 pour activer la boucle de preuve/i),
    ).toBeInTheDocument()
  })
})
