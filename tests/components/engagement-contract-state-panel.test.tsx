// DOC-CONTRACT-OS-1B2-B4 — le panneau est un CONSOMMATEUR pur du DTO B1/B3 :
// ces tests construisent des `EngagementContractStateDTO` fixtures directement
// (aucun appel réseau, aucune re-résolution temporelle) et vérifient uniquement
// le FORMATAGE. Aucun de ces tests n'invoque `resolveEngagementAtDate` ni
// `resolveEngagementContractStateForUser` — le panneau ne doit jamais dupliquer
// cette logique.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngagementContractStatePanel } from '@/app/(dashboard)/contracts/[id]/EngagementContractStatePanel'
import type { EngagementContractStateDTO, ScopeState } from '@/lib/engagements/resolve-contract-state'
import type { ResolveEngagementContractStateForUserResult } from '@/lib/engagements/resolve-contract-state-for-user'

function baseScope(overrides: Partial<ScopeState> = {}): ScopeState {
  return {
    scopeKey: 'frequency',
    applicability: 'applicable',
    dominatedByWholeEngagementSuspend: false,
    basis: 'engagement_base',
    value: null,
    sourceEffectId: null,
    valueConflict: null,
    applicabilityConflict: null,
    indeterminateReason: null,
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

function ok(state: EngagementContractStateDTO): ResolveEngagementContractStateForUserResult {
  return { ok: true, state }
}

describe('EngagementContractStatePanel — Engagement historique (legacy)', () => {
  it('indique explicitement l\'absence de reconstruction structurée, jamais "value=null"', () => {
    const state = baseState({
      existence: { status: 'exists', foundedBy: null, existsFrom: null, existsUntil: null },
      scopes: [baseScope({ basis: 'engagement_base', value: null })],
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getByText(/Engagement historique/)).toBeInTheDocument()
    expect(screen.getByText(/Valeur structurée non disponible/)).toBeInTheDocument()
    expect(screen.queryByText(/^null$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/value=null/i)).not.toBeInTheDocument()
  })
})

describe('EngagementContractStatePanel — MODIFY actif', () => {
  it('affiche la valeur structurée et l\'applicabilité "Applicable"', () => {
    const state = baseState({
      existence: { status: 'exists', foundedBy: 'effect-new-1', existsFrom: '2026-01-01', existsUntil: null },
      scopes: [baseScope({ scopeKey: 'frequency', basis: 'modify', applicability: 'applicable', value: 'hebdomadaire', sourceEffectId: 'effect-modify-1' })],
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getAllByText('Applicable').length).toBeGreaterThan(0)
    expect(screen.getByText(/hebdomadaire/)).toBeInTheDocument()
    expect(screen.queryByText(/Engagement historique/)).not.toBeInTheDocument()
  })
})

describe('EngagementContractStatePanel — SUSPEND actif', () => {
  it('affiche "Suspendu" sans effacer la valeur repliée', () => {
    const state = baseState({
      existence: { status: 'exists', foundedBy: 'effect-new-1', existsFrom: '2026-01-01', existsUntil: null },
      scopes: [
        baseScope({
          scopeKey: 'whole_engagement',
          basis: 'modify',
          applicability: 'suspended',
          value: 'mensuel',
          dominatedByWholeEngagementSuspend: true,
        }),
      ],
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getByText('Suspendu')).toBeInTheDocument()
    expect(screen.getByText(/mensuel/)).toBeInTheDocument()
    expect(screen.getByText(/Suspendu par l'Engagement entier/)).toBeInTheDocument()
  })
})

describe('EngagementContractStatePanel — indéterminé', () => {
  it('affiche "Indéterminé" et le motif, jamais une valeur inventée', () => {
    const state = baseState({
      existence: { status: 'exists', foundedBy: 'effect-new-1', existsFrom: '2026-01-01', existsUntil: null },
      scopes: [
        baseScope({
          scopeKey: 'whole_engagement',
          applicability: 'indeterminate',
          value: null,
          indeterminateReason: 'Suspension déclenchée par événement, aucune reprise démontrée.',
        }),
      ],
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getByText('Indéterminé')).toBeInTheDocument()
    expect(screen.getByText(/aucune reprise démontrée/)).toBeInTheDocument()
  })

  it('conflit de fondateurs (plusieurs NEW) : bandeau de conflit visible', () => {
    const state = baseState({
      existence: { status: 'undetermined', foundedBy: null, existsFrom: null, existsUntil: null },
      resolutionIssue: { type: 'multiple_new_founders', conflictingEffectIds: ['e1', 'e2'] },
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getByText('Indéterminé (conflit)')).toBeInTheDocument()
    expect(screen.getByText(/Conflit non résolu/)).toBeInTheDocument()
  })
})

describe('EngagementContractStatePanel — NEW borné expiré', () => {
  it('affiche "Expiré"', () => {
    const state = baseState({
      existence: { status: 'expired', foundedBy: 'effect-new-1', existsFrom: '2026-01-01', existsUntil: '2026-06-30' },
      scopes: [],
    })
    render(<EngagementContractStatePanel result={ok(state)} />)
    expect(screen.getByText('Expiré')).toBeInTheDocument()
  })
})

describe('EngagementContractStatePanel — refus d\'accès (cross-org)', () => {
  it('reste inaccessible : aucun oracle sur l\'existence, message neutre uniquement', () => {
    const denied: ResolveEngagementContractStateForUserResult = { ok: false, error: 'access_denied' }
    render(<EngagementContractStatePanel result={denied} />)
    expect(screen.getByText(/État contractuel non disponible/)).toBeInTheDocument()
    expect(screen.queryByText('Applicable')).not.toBeInTheDocument()
    expect(screen.queryByText('Expiré')).not.toBeInTheDocument()
  })

  it('résultat absent (non chargé) : ne rend rien plutôt que d\'inventer un état', () => {
    const { container } = render(<EngagementContractStatePanel result={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
