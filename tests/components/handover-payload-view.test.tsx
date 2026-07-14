import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HandoverPayloadView } from '@/app/(dashboard)/handovers/HandoverPayloadView'
import type { HandoverPayload } from '@/types/db'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

describe('handover payload view', () => {
  it('tells the person taking over what is already engaged after the handover', () => {
    render(<HandoverPayloadView payload={payloadFixture()} />)

    expect(screen.getByText('Prochaines échéances')).toBeInTheDocument()
    expect(screen.getByText('Nettoyage général')).toBeInTheDocument()
    expect(screen.getByText(/2026-07-21 · Équipe nettoyage/)).toBeInTheDocument()
    // Une échéance sans équipe est un trou, et le brief le dit.
    expect(screen.getByText(/équipe non affectée/)).toBeInTheDocument()
  })

  it('still renders briefs generated before the section existed', () => {
    const legacy = payloadFixture()
    delete legacy.sites[0].nextEvents

    render(<HandoverPayloadView payload={legacy} />)

    expect(screen.queryByText('Prochaines échéances')).not.toBeInTheDocument()
    expect(screen.getByText(/Aucune mémoire spécifique sur ce chantier/)).toBeInTheDocument()
  })
})

function payloadFixture(): HandoverPayload {
  return {
    generatedAt: '2026-07-14T08:00:00.000Z',
    context: 'L’équipe « Équipe nettoyage » prend en charge le site « Discount ».',
    manualNotes: null,
    sites: [
      {
        site_id: 'site-1',
        site_name: 'Discount',
        contract_id: null,
        contract_name: null,
        client_name: 'Servinor',
        aSavoir: [],
        recentAnomalies: [],
        documents: [],
        openReserves: [],
        openReservesMore: 0,
        openActions: [],
        openActionsMore: 0,
        recentDecisions: [],
        nextEvents: [
          { id: 'i-1', label: 'Nettoyage général', on: '2026-07-21', teamName: 'Équipe nettoyage' },
          { id: 'i-2', label: 'Vitrerie', on: '2026-07-24', teamName: null },
        ],
        neighborTeams: [],
        interventionsCount: 3,
        lastInterventionDate: '2026-07-10',
      },
    ],
  }
}
