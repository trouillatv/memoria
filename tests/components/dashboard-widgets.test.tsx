import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContractsUnderTensionWidget } from '@/app/(dashboard)/dashboard/ContractsUnderTensionWidget'
import { RecentActivityWidget } from '@/app/(dashboard)/dashboard/RecentActivityWidget'
import { AnomaliesOldWidget } from '@/app/(dashboard)/dashboard/AnomaliesOldWidget'
import type {
  ContractUnderTension,
  RecentActivityEvent,
} from '@/lib/db/dashboard'

// Doctrine V3 ultime — liste non-exhaustive de prénoms à proscrire.
const FORBIDDEN_NAMES =
  /\b(Mehdi|Léa|Lea|Sofia|Sofiane|Karim|Aïcha|Aicha|Yannick|Stéphane|Stephane|Camille|Julien|Marc|Marie|Pierre|Sophie|Aurélie|Aurelie|Nadia|Mohamed|Fatima|Sarah|Thomas|Emma|Lucas|Hugo|Léo|Leo)\b/i

function makeContract(p: Partial<ContractUnderTension> = {}): ContractUnderTension {
  return {
    contract_id: 'ctr-1',
    contract_name: 'CHU Régional',
    segmentScores: {
      promised: 1,
      planned: 0.8,
      executed: 0.6,
      proven: 0.4,
      validated: 0.5,
    },
    globalScore: 0.66,
    reasonDetail: 'Maillon faible : preuves (40%)',
    ...p,
  }
}

describe('ContractsUnderTensionWidget', () => {
  it('returns null (renders nothing) when the list is empty', () => {
    const { container } = render(<ContractsUnderTensionWidget contracts={[]} />)
    expect(container.firstChild).toBeNull()
    expect(container.querySelector('[data-slot="contracts-under-tension"]')).toBeNull()
  })

  it('renders one contract with name, globalScore in % and segments visible', () => {
    const c = makeContract()
    const { container } = render(<ContractsUnderTensionWidget contracts={[c]} />)
    expect(screen.getByText('CHU Régional')).toBeInTheDocument()
    // 0.66 → 66%
    expect(screen.getByText(/Boucle 66\s*%/)).toBeInTheDocument()
    expect(screen.getByText('Maillon faible : preuves (40%)')).toBeInTheDocument()
    // Les 5 segments sont rendus (sous le wrapper segment-bar)
    const bar = container.querySelector('[data-testid="segment-bar"]') as HTMLElement
    expect(bar).not.toBeNull()
    const segments = bar.querySelectorAll('[data-testid^="segment-"]')
    expect(segments.length).toBe(5)
  })

  it('applies amber class on segments < 0.5 and emerald on >= 0.5', () => {
    const c = makeContract({
      segmentScores: {
        promised: 1,       // emerald
        planned: 0.49,     // amber
        executed: 0.5,     // emerald
        proven: 0.1,       // amber
        validated: 0.9,    // emerald
      },
    })
    const { container } = render(<ContractsUnderTensionWidget contracts={[c]} />)
    const planned = container.querySelector('[data-testid="segment-planned"]') as HTMLElement
    const proven = container.querySelector('[data-testid="segment-proven"]') as HTMLElement
    const executed = container.querySelector('[data-testid="segment-executed"]') as HTMLElement
    expect(planned.getAttribute('data-low')).toBe('true')
    expect(planned.className).toMatch(/bg-amber-300/)
    expect(proven.getAttribute('data-low')).toBe('true')
    expect(proven.className).toMatch(/bg-amber-300/)
    expect(executed.getAttribute('data-low')).toBe('false')
    expect(executed.className).toMatch(/bg-emerald-300/)
  })
})

function makeEvent(p: Partial<RecentActivityEvent> = {}): RecentActivityEvent {
  return {
    type: 'intervention_executed',
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // il y a 1h
    label: 'Bionettoyage CHU sanitaires exécuté · 6 photos',
    contextLabel: 'CHU Régional',
    href: '/preuves/intv-1',
    ...p,
  }
}

describe('RecentActivityWidget', () => {
  it('returns null (renders nothing) when there are no events', () => {
    const { container } = render(<RecentActivityWidget events={[]} />)
    expect(container.firstChild).toBeNull()
    expect(container.querySelector('[data-slot="recent-activity"]')).toBeNull()
  })

  it('renders 3 rows for 3 events', () => {
    const events: RecentActivityEvent[] = [
      makeEvent({ label: 'Mémoire technique « CHU » générée', type: 'tender_ready', href: '/tenders/t1' }),
      makeEvent({ label: 'Anomalie résolue', type: 'anomaly_resolved' }),
      makeEvent({ label: 'Contrat « Mairie » activé', type: 'contract_activated', href: '/contracts/c1' }),
    ]
    const { container } = render(<RecentActivityWidget events={events} />)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
  })

  it('renders an event without href as a non-Link wrapper', () => {
    const events: RecentActivityEvent[] = [
      makeEvent({ label: 'Sans lien', href: undefined }),
      makeEvent({ label: 'Avec lien', href: '/preuves/abc' }),
    ]
    const { container } = render(<RecentActivityWidget events={events} />)
    const links = container.querySelectorAll('a')
    // Une seule ligne possède un Link
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/preuves/abc')
    // Texte « Sans lien » présent mais hors <a>
    expect(screen.getByText('Sans lien')).toBeInTheDocument()
    expect(links[0].textContent ?? '').not.toMatch(/Sans lien/)
  })

  it("doctrine V3 ultime : aucun prénom typique n'apparaît dans le rendu", () => {
    // Données entièrement neutres — on vérifie que la structure n'introduit
    // jamais un prénom (label de section, fallback, etc.).
    const events: RecentActivityEvent[] = [
      makeEvent(),
      makeEvent({
        type: 'intervention_validated',
        label: 'Cantine Jaurès validée',
        contextLabel: 'École Jaurès',
      }),
      makeEvent({
        type: 'anomaly_resolved',
        label: 'Anomalie résolue',
        contextLabel: 'Mairie Centrale',
      }),
    ]
    const { container } = render(<RecentActivityWidget events={events} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(FORBIDDEN_NAMES)
  })
})

describe('AnomaliesOldWidget', () => {
  it('renders nothing when oldCount is 0', () => {
    const { container } = render(<AnomaliesOldWidget oldCount={0} />)
    expect(container.firstChild).toBeNull()
    expect(container.querySelector('[data-slot="anomalies-old"]')).toBeNull()
  })

  it('renders plural form when oldCount > 1', () => {
    render(<AnomaliesOldWidget oldCount={2} />)
    expect(
      screen.getByText(/2 anomalies ouvertes depuis plus de 3 jours/),
    ).toBeInTheDocument()
  })

  it('renders singular form when oldCount is 1', () => {
    render(<AnomaliesOldWidget oldCount={1} />)
    expect(
      screen.getByText(/1 anomalie ouverte depuis plus de 3 jours/),
    ).toBeInTheDocument()
  })
})
