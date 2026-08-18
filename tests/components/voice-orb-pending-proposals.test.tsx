// Lot A — bandeau de propositions vocales en attente (Vincent, 2026-08-18).
//
// Deux couches testées séparément :
//   1. L'état partagé (`pendingProposals` dans VoiceOrbProvider), prouvé par le
//      flux RÉEL de GlobalVoiceCopilotSheet — une question TAPÉE traverse le
//      même code (`pushResultMessage`/`addPendingProposal`/`onCancel`) qu'un
//      tour vocal, sans avoir à mocker tout le pipeline micro/audio pour ce qui
//      reste un test d'état.
//   2. Le rendu du bandeau sticky dans VoiceOrbOverlay, isolé via un contexte
//      contrôlé — `getUserMedia` est refusé pour atteindre une phase non-idle
//      (`error`) sans dépendre d'AudioContext/MediaRecorder/VAD.
//
// Le scénario 5 (plusieurs propositions) est injecté artificiellement dans le
// contexte, comme demandé : le système ne produit aujourd'hui qu'une
// proposition par tour, P6-B n'est pas branché ici.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { VoiceOrbProvider } from '@/app/(field)/m/VoiceOrbProvider'
import { useVoiceOrb, VoiceOrbContext, type PendingProposal, type VoiceOrbContextValue } from '@/app/(field)/m/VoiceOrbContext'
import { GlobalVoiceCopilotSheet } from '@/app/(field)/m/GlobalVoiceCopilotSheet'
import { VoiceOrbOverlay } from '@/components/field/VoiceOrbOverlay'
import { buildFactProposal } from '@/lib/visits/copilot-proposal'
import type { CopilotFreeResult } from '@/lib/visits/copilot-free-prepare'
import type { CopilotProposal } from '@/lib/visits/copilot-proposal'

const askCopilotFreeAction = vi.fn()
vi.mock('@/app/(dashboard)/sites/[id]/copilot-free-action', () => ({
  askCopilotFreeAction: (input: unknown) => askCopilotFreeAction(input),
}))

const createCopilotFact = vi.fn()
vi.mock('@/app/(dashboard)/sites/[id]/copilot-write-action', () => ({
  createCopilotFact: (input: unknown) => createCopilotFact(input),
}))
vi.mock('@/app/(dashboard)/sites/[id]/copilot-event-action', () => ({
  trackCopilotProposalCancelled: vi.fn(),
}))

const listMeetingSitesAction = vi.fn()
vi.mock('@/app/(field)/m/meeting-actions', () => ({
  listMeetingSitesAction: () => listMeetingSitesAction(),
}))

const SITE = { id: '44444444-4444-4444-4444-444444444444', name: 'Chantier PETRO' }

function factResult(question: string): CopilotFreeResult {
  return {
    kind: 'proposal',
    text: 'Voici ce que je propose.',
    proposal: buildFactProposal({ question, canonicalSubjectId: null, canonicalSubjectLabel: null }),
    interactionId: null,
  }
}

function answerResult(text: string): CopilotFreeResult {
  return { kind: 'answer', text, references: [], source: 'fallback', interactionId: null }
}

/** P6-B (mandat Vincent, 2026-08-19) : résultat multi-propositions d'un même tour. */
function proposalsResult(
  items: { text: string; proposal: CopilotProposal; interactionId: string | null; segmentText: string }[],
): CopilotFreeResult {
  return {
    kind: 'proposals',
    proposals: items.map((item, segmentIndex) => ({ ...item, segmentIndex })),
  }
}

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  listMeetingSitesAction.mockResolvedValue([SITE])
  createCopilotFact.mockResolvedValue({ ok: true })
  stubMatchMedia()
  // jsdom n'implémente pas scrollIntoView (fil de conversation, bouton Voir).
  Element.prototype.scrollIntoView = vi.fn()
})

// ── Couche 1 : état partagé via le flux réel de la feuille ─────────────────────

/** Sonde de test : lit/pilote l'état partagé sans passer par l'orbe vocal. */
function PendingProposalsProbe() {
  const { pendingProposals, addPendingProposal, removePendingProposal } = useVoiceOrb()
  return (
    <div>
      <span data-testid="probe-count">{pendingProposals.length}</span>
      {pendingProposals.map((p) => (
        <span key={p.id} data-testid="probe-item">{p.kindLabel} — {p.title}</span>
      ))}
      <button type="button" onClick={() => addPendingProposal({ id: 'injected-1', kind: 'watchpoint', kindLabel: 'Point à surveiller', title: 'Fissure façade nord' })}>
        inject-1
      </button>
      <button type="button" onClick={() => addPendingProposal({ id: 'injected-2', kind: 'deadline', kindLabel: 'Échéance', title: 'Livraison ferronnerie' })}>
        inject-2
      </button>
      <button type="button" onClick={() => removePendingProposal('injected-1')}>remove-1</button>
    </div>
  )
}

function renderSheet() {
  return render(
    <VoiceOrbProvider>
      <PendingProposalsProbe />
      <GlobalVoiceCopilotSheet open onClose={() => {}} />
    </VoiceOrbProvider>,
  )
}

async function selectSite() {
  await waitFor(() => expect(screen.getByText(SITE.name)).toBeInTheDocument())
  fireEvent.click(screen.getByText(SITE.name))
}

function askTyped(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Posez une question…'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
}

describe('GlobalVoiceCopilotSheet — pendingProposals (état partagé)', () => {
  it('1 — une proposition créée alimente pendingProposals avec kindLabel + title', async () => {
    askCopilotFreeAction.mockResolvedValue(factResult('Le portail est fermé le week-end'))
    renderSheet()
    await selectSite()

    askTyped('Le portail est fermé le week-end')

    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('probe-item')).toHaveTextContent('Information —')
    expect(screen.getByRole('button', { name: /valider/i })).toBeInTheDocument()
  })

  it('2 — un tour READ suivant laisse la proposition en attente', async () => {
    askCopilotFreeAction.mockResolvedValueOnce(factResult('Le portail est fermé le week-end'))
    renderSheet()
    await selectSite()

    askTyped('Le portail est fermé le week-end')
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('1'))

    askCopilotFreeAction.mockResolvedValueOnce(answerResult('Le dernier passage remonte à hier.'))
    askTyped('Quand est passé Jérôme ?')

    await waitFor(() => expect(screen.getByText('Le dernier passage remonte à hier.')).toBeInTheDocument())
    expect(screen.getByTestId('probe-count')).toHaveTextContent('1')
  })

  it('3 — Valider retire la proposition de pendingProposals', async () => {
    askCopilotFreeAction.mockResolvedValue(factResult('Le portail est fermé le week-end'))
    renderSheet()
    await selectSite()
    askTyped('Le portail est fermé le week-end')
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('1'))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'current_information' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /valider/i }))
    })

    await waitFor(() => expect(createCopilotFact).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('0'))
    expect(screen.queryByTestId('probe-item')).not.toBeInTheDocument()
  })

  it('4 — Annuler retire la proposition de pendingProposals', async () => {
    askCopilotFreeAction.mockResolvedValue(factResult('Le portail est fermé le week-end'))
    renderSheet()
    await selectSite()
    askTyped('Le portail est fermé le week-end')
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('1'))

    fireEvent.click(screen.getByRole('button', { name: /annuler/i }))

    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('0'))
    expect(screen.getByText(/proposition annulée/i)).toBeInTheDocument()
  })

  it('5 — plusieurs propositions injectées artificiellement : compteur et libellés corrects', async () => {
    renderSheet()

    fireEvent.click(screen.getByText('inject-1'))
    fireEvent.click(screen.getByText('inject-2'))

    expect(screen.getByTestId('probe-count')).toHaveTextContent('2')
    const items = screen.getAllByTestId('probe-item')
    expect(items.map((el) => el.textContent)).toEqual([
      'Point à surveiller — Fissure façade nord',
      'Échéance — Livraison ferronnerie',
    ])

    fireEvent.click(screen.getByText('remove-1'))
    expect(screen.getByTestId('probe-count')).toHaveTextContent('1')
    expect(screen.getByTestId('probe-item')).toHaveTextContent('Échéance — Livraison ferronnerie')
  })
})

// ── P6-B — plusieurs propositions RÉELLES pour un même tour (mandat Vincent, 2026-08-19) ──
//
// Contrairement au scénario 5 ci-dessus (injection artificielle), ces tests
// passent par le VRAI résultat `kind:'proposals'` renvoyé par le pipeline —
// prouvant le câblage `pushResultMessage` (GlobalVoiceCopilotSheet.tsx:154-168)
// et non plus seulement l'état partagé isolé.

describe('GlobalVoiceCopilotSheet — P6-B, plusieurs propositions pour un même tour', () => {
  it('8 — un résultat kind:"proposals" à 2 éléments alimente pendingProposals.length === 2', async () => {
    const p1 = buildFactProposal({ question: 'Le code du portail est 4812.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    const p2 = buildFactProposal({ question: 'Le compresseur est en panne.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    askCopilotFreeAction.mockResolvedValue(proposalsResult([
      { text: 'Constat 1', proposal: p1, interactionId: 'iid-1', segmentText: 'Le code du portail est 4812.' },
      { text: 'Constat 2', proposal: p2, interactionId: 'iid-2', segmentText: 'Le compresseur est en panne.' },
    ]))
    renderSheet()
    await selectSite()

    askTyped('Le code du portail est 4812. Le compresseur est en panne.')

    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('2'))
    expect(screen.getAllByTestId('probe-item')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /valider/i })).toHaveLength(2)
  })

  it('9 — valider une proposition parmi 2 laisse l\'autre en attente', async () => {
    const p1 = buildFactProposal({ question: 'Le code du portail est 4812.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    const p2 = buildFactProposal({ question: 'Le compresseur est en panne.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    askCopilotFreeAction.mockResolvedValue(proposalsResult([
      { text: 'Constat 1', proposal: p1, interactionId: 'iid-1', segmentText: 'Le code du portail est 4812.' },
      { text: 'Constat 2', proposal: p2, interactionId: 'iid-2', segmentText: 'Le compresseur est en panne.' },
    ]))
    renderSheet()
    await selectSite()
    askTyped('Le code du portail est 4812. Le compresseur est en panne.')
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('2'))

    const combos = screen.getAllByRole('combobox')
    fireEvent.change(combos[0], { target: { value: 'current_information' } })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /valider/i })[0])
    })

    // Même primitive d'écriture que le mono (aucun nouveau writer introduit par P6-B).
    await waitFor(() => expect(createCopilotFact).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('probe-item')).toHaveTextContent(p2.title)
  })

  it('10 (volet UI) — chaque proposition P6-B garde son propre interactionId côté carte', async () => {
    const p1 = buildFactProposal({ question: 'Le code du portail est 4812.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    const p2 = buildFactProposal({ question: 'Le compresseur est en panne.', canonicalSubjectId: null, canonicalSubjectLabel: null })
    askCopilotFreeAction.mockResolvedValue(proposalsResult([
      { text: 'Constat 1', proposal: p1, interactionId: 'iid-p6-a', segmentText: 'Le code du portail est 4812.' },
      { text: 'Constat 2', proposal: p2, interactionId: 'iid-p6-b', segmentText: 'Le compresseur est en panne.' },
    ]))
    renderSheet()
    await selectSite()
    askTyped('Le code du portail est 4812. Le compresseur est en panne.')
    await waitFor(() => expect(screen.getByTestId('probe-count')).toHaveTextContent('2'))

    // Les deux cartes coexistent, chacune identifiable par son propre id DOM
    // (`copilot-proposal-${msg.id}`, dérivé du pendingProposal.id) — pas de
    // pipeline parallèle, pas de fusion des deux propositions en une seule.
    expect(document.querySelectorAll('[id^="copilot-proposal-"]')).toHaveLength(2)
  })
})

// ── Couche 2 : rendu du bandeau sticky dans VoiceOrbOverlay ────────────────────

function stubMicDenied() {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) },
    configurable: true,
  })
}

function renderOverlay(pendingProposals: PendingProposal[]) {
  const viewPendingProposal = vi.fn()
  const value: VoiceOrbContextValue = {
    openOrb: () => {},
    pendingProposals,
    addPendingProposal: () => {},
    removePendingProposal: () => {},
    viewPendingProposal,
    registerProposalViewHandler: () => {},
  }
  render(
    <VoiceOrbContext.Provider value={value}>
      <VoiceOrbOverlay open siteId={SITE.id} onVoiceTurn={async () => ({})} onClose={() => {}} />
    </VoiceOrbContext.Provider>,
  )
  return { viewPendingProposal }
}

const ONE: PendingProposal[] = [
  { id: 'p1', kind: 'watchpoint', kindLabel: 'Point à surveiller', title: 'Fissure façade nord' },
]
const TWO: PendingProposal[] = [
  ...ONE,
  { id: 'p2', kind: 'deadline', kindLabel: 'Échéance', title: 'Livraison ferronnerie' },
]

describe('VoiceOrbOverlay — bandeau sticky', () => {
  beforeEach(stubMicDenied)

  it('aucune proposition en attente → pas de bandeau', async () => {
    renderOverlay([])
    await waitFor(() => expect(screen.getByText(/toucher pour réessayer|réessayer/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /voir/i })).not.toBeInTheDocument()
  })

  it('1 proposition en attente → bandeau visible avec type + libellé, sans compteur', async () => {
    renderOverlay(ONE)
    await waitFor(() => expect(screen.getByRole('button', { name: /voir/i })).toBeInTheDocument())
    expect(screen.getByText('Point à surveiller')).toBeInTheDocument()
    expect(screen.getByText('Fissure façade nord')).toBeInTheDocument()
    expect(screen.queryByText(/propositions en attente/i)).not.toBeInTheDocument()
  })

  it('plusieurs propositions en attente → compteur + un bouton Voir par proposition', async () => {
    renderOverlay(TWO)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /voir/i })).toHaveLength(2))
    expect(screen.getByText('2 propositions en attente')).toBeInTheDocument()
    expect(screen.getByText('Fissure façade nord')).toBeInTheDocument()
    expect(screen.getByText('Livraison ferronnerie')).toBeInTheDocument()
  })

  it('clic sur Voir déclenche viewPendingProposal avec l\'id de la proposition', async () => {
    const { viewPendingProposal } = renderOverlay(TWO)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /voir/i })).toHaveLength(2))

    fireEvent.click(screen.getAllByRole('button', { name: /voir/i })[1])

    expect(viewPendingProposal).toHaveBeenCalledWith('p2')
  })
})

// ── Couche 3 : retour automatique à l'orbe après Voir (Vincent, 2026-08-18) ────
//
// Corrige le parcours signalé en recette OCEF : Voir → feuille → Valider ne
// doit pas laisser l'utilisateur échoué dans l'historique de la feuille.
// Testé via le provider réel (pas de mock) : `useVoiceOrb()` pilote openOrb /
// viewPendingProposal / removePendingProposal exactement comme le bandeau et
// les cartes de proposition le font en production.

function ReturnToOrbProbe() {
  const { openOrb, addPendingProposal, removePendingProposal, viewPendingProposal } = useVoiceOrb()
  return (
    <div>
      <button type="button" onClick={() => openOrb({ siteId: SITE.id, onVoiceTurn: async () => ({}) })}>
        open-orb
      </button>
      <button
        type="button"
        onClick={() => addPendingProposal({ id: 'r1', kind: 'watchpoint', kindLabel: 'Point à surveiller', title: 'Fissure façade nord' })}
      >
        add-proposal
      </button>
      <button type="button" onClick={() => viewPendingProposal('r1')}>voir</button>
      <button type="button" onClick={() => removePendingProposal('r1')}>resolve</button>
    </div>
  )
}

function renderReturnToOrb() {
  return render(
    <VoiceOrbProvider>
      <ReturnToOrbProbe />
    </VoiceOrbProvider>,
  )
}

describe('VoiceOrbProvider — retour automatique à l\'orbe après Voir', () => {
  beforeEach(stubMicDenied)

  it('Voir depuis le bandeau ferme l\'orbe (la feuille redevient visible dessous)', async () => {
    renderReturnToOrb()
    fireEvent.click(screen.getByText('open-orb'))
    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())

    fireEvent.click(screen.getByText('add-proposal'))
    fireEvent.click(screen.getByText('voir'))

    await waitFor(() => expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument())
  })

  it('résoudre la proposition consultée via Voir restitue automatiquement l\'orbe', async () => {
    renderReturnToOrb()
    fireEvent.click(screen.getByText('open-orb'))
    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())
    fireEvent.click(screen.getByText('add-proposal'))
    fireEvent.click(screen.getByText('voir'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument())

    // Équivalent de Valider/Annuler dans la feuille : la carte disparaît de
    // pendingProposals, il n'en reste aucune → retour automatique à l'orbe.
    fireEvent.click(screen.getByText('resolve'))

    await waitFor(() => expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument())
  })
})
