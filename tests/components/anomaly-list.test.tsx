import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AnomalyList } from '@/app/(field)/m/intervention/[id]/AnomalyList'
import type { DbInterventionAnomaly } from '@/types/db'

const { ignoreAnomalyMobileActionMock } = vi.hoisted(() => ({
  ignoreAnomalyMobileActionMock: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('@/app/(field)/m/intervention/[id]/actions', () => ({
  ignoreAnomalyMobileAction: (id: string) => ignoreAnomalyMobileActionMock(id),
}))

const anomaly: DbInterventionAnomaly = {
  id: '11111111-1111-1111-1111-111111111111',
  intervention_id: '22222222-2222-2222-2222-222222222222',
  engagement_id: null,
  category: 'electricite_coupee',
  category_other: null,
  description: 'Disjoncteur général coupé au local technique.',
  status: 'open',
  resolved_at: null,
  resolution_note: null,
  created_at: '2026-06-13T01:00:00.000Z',
  reported_by: null,
}

describe('AnomalyList mobile', () => {
  beforeEach(() => {
    ignoreAnomalyMobileActionMock.mockClear()
  })

  it('affiche le détail du signalement dans un panneau consultable', () => {
    render(<AnomalyList anomalies={[anomaly]} canDelete />)

    expect(screen.getByText(/signalements \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText('Électricité coupée')).toBeInTheDocument()
    expect(screen.getByText('Disjoncteur général coupé au local technique.')).toBeInTheDocument()
  })

  it('permet de retirer rapidement un signalement seulement si l’intervention est en cours', async () => {
    render(<AnomalyList anomalies={[anomaly]} canDelete />)

    fireEvent.click(screen.getByRole('button', { name: /retirer le signalement/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirmer le retrait/i }))

    await waitFor(() => {
      expect(ignoreAnomalyMobileActionMock).toHaveBeenCalledWith(anomaly.id)
    })
    expect(screen.queryByText('Électricité coupée')).not.toBeInTheDocument()
  })

  it('masque la suppression hors intervention en cours', () => {
    render(<AnomalyList anomalies={[anomaly]} canDelete={false} />)

    expect(screen.queryByRole('button', { name: /retirer le signalement/i })).not.toBeInTheDocument()
  })
})
