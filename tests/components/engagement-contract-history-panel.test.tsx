// DOC-CONTRACT-OS-1B3 — le panneau est un CONSOMMATEUR pur du presenter
// `buildEngagementContractHistoryViewModel` : ces tests construisent des
// `EngagementContractStateDTO` fixtures directement et ouvrent le Sheet pour
// vérifier le RENDU réel (jamais l'UUID d'un document non visible dans le DOM).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EngagementContractHistoryPanel } from '@/app/(dashboard)/contracts/[id]/EngagementContractHistoryPanel'
import type { EngagementContractStateDTO, ProvenanceEntry } from '@/lib/engagements/resolve-contract-state'

function entry(overrides: Partial<ProvenanceEntry> & Pick<ProvenanceEntry, 'effectId' | 'effect' | 'scopeKey'>): ProvenanceEntry {
  return {
    temporality: 'permanent',
    startsOn: null,
    endsOn: null,
    resumeOn: null,
    sourceDocumentId: 'doc-1',
    sourceProposalId: 'proposal-1',
    recordedInMemoriaAt: '2026-01-01T00:00:00Z',
    recordedAfterQueriedDate: false,
    orphaned: false,
    usedInResolution: true,
    ...overrides,
  }
}

function baseState(overrides: Partial<EngagementContractStateDTO> = {}): EngagementContractStateDTO {
  return {
    engagementId: 'eng-1',
    queriedDate: '2026-09-29',
    resolvable: true,
    resolutionIssue: null,
    existence: { status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null },
    scopes: [],
    anomalies: [],
    provenanceTrail: [],
    ...overrides,
  }
}

async function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: /voir l'historique/i }))
  return screen.findByText('Historique contractuel')
}

describe('EngagementContractHistoryPanel — état non chargé', () => {
  it('ne rend rien si state est undefined', () => {
    const { container } = render(<EngagementContractHistoryPanel state={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EngagementContractHistoryPanel — Engagement historique (legacy)', () => {
  it('affiche le message legacy, jamais une timeline fabriquée', async () => {
    render(<EngagementContractHistoryPanel state={baseState({ provenanceTrail: [] })} />)
    await openHistory()
    expect(screen.getByText(/Engagement historique/)).toBeInTheDocument()
  })
})

describe('EngagementContractHistoryPanel — visibilité documentaire (sécurité)', () => {
  it('document non visible pour ce rôle : mention neutre affichée, UUID jamais dans le DOM', async () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'effect-modify-1',
          effect: 'modify',
          scopeKey: 'frequency',
          startsOn: '2026-03-01',
          sourceDocumentId: 'doc-hidden-secret-uuid',
        }),
      ],
    })
    const { container } = render(
      <EngagementContractHistoryPanel state={state} documentTitleById={new Map([['doc-os15', 'OS15']])} />,
    )
    await openHistory()
    expect(screen.getByText(/Source : document à accès restreint/)).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('doc-hidden-secret-uuid')
  })

  it('document visible : titre affiché', async () => {
    const state = baseState({
      provenanceTrail: [
        entry({
          effectId: 'effect-confirm-1',
          effect: 'confirm',
          scopeKey: 'whole_engagement',
          startsOn: '2026-12-01',
          sourceDocumentId: 'doc-os15',
        }),
      ],
    })
    render(<EngagementContractHistoryPanel state={state} documentTitleById={new Map([['doc-os15', 'OS15']])} />)
    await openHistory()
    expect(screen.getByText(/Confirmé par OS15/)).toBeInTheDocument()
  })
})

describe('EngagementContractHistoryPanel — indéterminé', () => {
  it('affiche le motif moteur, jamais une reprise inventée', async () => {
    const reason = 'Suspension déclenchée par événement, aucune reprise démontrée.'
    const state = baseState({
      scopes: [
        {
          scopeKey: 'whole_engagement',
          applicability: 'indeterminate',
          dominatedByWholeEngagementSuspend: false,
          basis: 'engagement_base',
          value: null,
          sourceEffectId: null,
          valueConflict: null,
          applicabilityConflict: null,
          indeterminateReason: reason,
        },
      ],
      provenanceTrail: [
        entry({
          effectId: 'e1',
          effect: 'suspend',
          scopeKey: 'whole_engagement',
          temporality: 'event_driven',
          startsOn: '2026-12-10',
        }),
      ],
    })
    render(<EngagementContractHistoryPanel state={state} />)
    await openHistory()
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByText(/reprise non déterminable/)).toBeInTheDocument()
  })
})
