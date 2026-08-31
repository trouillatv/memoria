// D4 — intégration du Débrief vivant (LiveDebrief) dans la vraie surface
// « À savoir avant d'y aller » (SiteBriefButton). Le classement Action/Échéance/
// Réserve/signal → à_traiter/à_surveiller/traité_récemment est déjà exhaustivement
// prouvé côté read-model dans tests/knowledge/live-debrief.test.ts (buildLiveDebrief,
// actionToItem, deadlineToItem, reserveToItem, informationalItems). Ce fichier ne
// reteste donc PAS cette classification : il prouve que la surface UI restitue
// fidèlement un LiveDebrief déjà classé — placement dans le bon bloc, lien réel,
// affordance « Vu » strictement limitée aux signaux informationnels non vus,
// première visite représentée correctement, et absence de tout bouton
// Régénérer propre au LiveDebrief (doctrine D4 : pas de statut ni de
// régénération propriétaires — cf. CLAUDE.md / GO D4).

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import type { SiteBrief } from '@/app/(dashboard)/sites/[id]/site-brief-actions'
import type { LiveDebrief, LiveDebriefItem } from '@/lib/knowledge/live-debrief'

const SITE_ID = '33333333-3333-3333-3333-333333333333'

const {
  mockGetSiteBriefAction,
  mockMarkSeen,
  mockCompleteDeadline,
  mockRescheduleDeadline,
  mockCloseAction,
  mockLiftReserve,
} = vi.hoisted(() => ({
  mockGetSiteBriefAction: vi.fn(),
  mockMarkSeen: vi.fn(async () => ({ ok: true as const })),
  mockCompleteDeadline: vi.fn(async () => ({ ok: true as const })),
  mockRescheduleDeadline: vi.fn(async () => ({ ok: true as const })),
  mockCloseAction: vi.fn(async () => ({ ok: true as const })),
  mockLiftReserve: vi.fn(async (): Promise<{ ok: true } | { error: string }> => ({ ok: true })),
}))

vi.mock('@/app/(dashboard)/sites/[id]/site-brief-actions', () => ({
  getSiteBriefAction: mockGetSiteBriefAction,
  logBriefOpenAction: vi.fn(async () => {}),
  generateDiscussionPointsAction: vi.fn(async () => ({ ok: true as const, points: [], mock: false, hadInput: false })),
}))

vi.mock('@/app/(dashboard)/sites/[id]/live-debrief-signal-actions', () => ({
  markLiveDebriefSignalSeenAction: mockMarkSeen,
}))

vi.mock('@/app/(dashboard)/sites/[id]/views/planning/deadline-actions', () => ({
  completeDeadlineAction: mockCompleteDeadline,
  rescheduleDeadlineAction: mockRescheduleDeadline,
}))

vi.mock('@/app/(dashboard)/actions/actions', () => ({
  closeActionAction: mockCloseAction,
}))

vi.mock('@/app/(dashboard)/sites/[id]/reserves/actions', () => ({
  liftReserveAction: mockLiftReserve,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const actionOpen: LiveDebriefItem = {
  kind: 'action',
  id: 'act-open-1',
  title: 'Réparer la clôture Nord',
  status: 'open',
  disposition: 'to_handle',
  date: '2026-08-20',
  canonicalSubjectId: null,
  reportId: null,
  href: `/sites/${SITE_ID}/action/act-open-1`,
}

const actionDoneRecent: LiveDebriefItem = {
  kind: 'action',
  id: 'act-done-1',
  title: 'Nettoyer la base vie',
  status: 'done',
  disposition: 'recently_handled',
  date: '2026-08-25',
  canonicalSubjectId: null,
  reportId: null,
  href: `/sites/${SITE_ID}/action/act-done-1`,
}

const deadlineToPlan: LiveDebriefItem = {
  kind: 'deadline',
  id: 'dl-1',
  title: 'Envoyer le DOE',
  status: 'to_plan',
  disposition: 'to_handle',
  date: null,
  canonicalSubjectId: null,
  reportId: null,
  href: `/sites/${SITE_ID}?tab=planning&plantab=echeances`,
}

const reserveOpen: LiveDebriefItem = {
  kind: 'reserve',
  id: 'res-1',
  title: 'Rejointoyer le carrelage hall',
  status: 'open',
  disposition: 'to_handle',
  date: '2026-08-10',
  canonicalSubjectId: null,
  reportId: null,
  href: `/sites/${SITE_ID}/reserve/res-1`,
}

const deadlinePlanned: LiveDebriefItem = {
  kind: 'deadline',
  id: 'dl-2',
  title: 'Livrer le plan de récolement',
  status: 'planned',
  disposition: 'to_watch',
  date: '2026-09-15',
  canonicalSubjectId: null,
  reportId: null,
  href: `/sites/${SITE_ID}?tab=planning&plantab=echeances`,
}

const signalUnseen: LiveDebriefItem = {
  kind: 'informational_signal',
  canonicalSubjectId: 'cs-1',
  signalKey: 'cs-1:pv_aggrave',
  title: 'Fissure façade — situation aggravée au dernier PV',
  disposition: 'to_watch',
  ack: 'unseen',
  reasons: ['Signalé aggravé dans le PV du 20 août'],
  href: `/sites/${SITE_ID}/subjects/cs-1`,
}

const signalSeen: LiveDebriefItem = {
  kind: 'informational_signal',
  canonicalSubjectId: 'cs-2',
  signalKey: 'cs-2:stagnant',
  title: 'Fuite réseau EU — stagnante',
  disposition: 'recently_handled',
  ack: 'seen',
  reasons: [],
  href: `/sites/${SITE_ID}/subjects/cs-2`,
}

function makeLiveDebrief(overrides: Partial<LiveDebrief> = {}): LiveDebrief {
  return {
    siteId: SITE_ID,
    confirmedToday: {
      actionsActive: 1,
      actionsOverdue: 0,
      deadlinesToPlan: 1,
      deadlinesPlanned: 0,
      reservesOpen: 1,
      nextEvent: null,
    },
    sinceLastVisit: {
      kind: 'delta',
      at: '2026-08-20T08:00:00.000Z',
      visitDateLabel: '20 août',
      daysAgo: 10,
      personal: true,
      items: [{ kind: 'action_done', label: 'Peinture hall terminée', at: '2026-08-22T08:00:00.000Z' }],
      overflow: 0,
    },
    toHandle: [actionOpen, deadlineToPlan, reserveOpen],
    toWatch: [signalUnseen],
    recentlyHandled: [actionDoneRecent, signalSeen],
    recentActivity: [],
    ...overrides,
  }
}

function makeBrief(liveDebrief: LiveDebrief, canLiftReserve = true): SiteBrief {
  return {
    siteName: 'Chantier Test',
    contractName: null,
    situation: { openActions: 0, openAnomalies: 0, nextScheduledAt: null, passagesThisMonth: 0 },
    vigilance: [],
    openActions: [],
    recentDoneActions: [],
    anomaliesOpen: [],
    aSavoir: [],
    recurring: [],
    teams: [],
    missionNames: [],
    recentPhotosCount: 0,
    meetings: [],
    openReserves: [],
    lastReport: null,
    changeSinceLastReport: null,
    followedPoints: [],
    phase: 'follow_up',
    phaseLabel: 'Suivi',
    minuteSummary: [],
    urgentItems: [],
    blockedItems: [],
    lastPresence: null,
    activities: [],
    persistedNarrative: null,
    sinceLastVenue: null,
    changedSinceVenue: [],
    beforeLeaving: [],
    verificationQuestions: [],
    deadlines: [],
    decisions: [],
    narratives: [],
    proofs: [],
    objective: null,
    estimatedPhase: 'follow_up',
    freshness: { days: 0, label: "aujourd'hui", level: 'recent', at: null },
    freshnessKind: null,
    coherenceInsights: [],
    rememberToday: [],
    completedSinceVenue: [],
    unknowns: [],
    openActivityItems: [],
    activityReadModel: {
      interventionStarted: null,
      dayIndex: null,
      activitiesInProgress: [],
      activitiesStartedRecently: [],
      stillOpen: [],
      toReconfirm: [],
    },
    liveDebrief,
    canLiftReserve,
  }
}

function sectionByHeading(headingText: string): HTMLElement {
  const heading = screen.getByText(headingText)
  const section = heading.closest('section')
  if (!section) throw new Error(`section introuvable pour « ${headingText} »`)
  return section as HTMLElement
}

async function openBrief(liveDebrief: LiveDebrief = makeLiveDebrief()) {
  mockGetSiteBriefAction.mockResolvedValue({ ok: true, brief: makeBrief(liveDebrief) })
  render(<SiteBriefButton siteId={SITE_ID} mode="visit" />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /préparer ma visite/i }))
  })
  await screen.findByText('À traiter')
}

// D5 — variante qui distingue le brief initial du brief renvoyé par le
// refetchBrief() déclenché après une mutation inline (Planifier/Marquer
// réalisée/Clôturer/Lever), pour prouver le changement de bloc immédiat.
async function openBriefSeq(responses: { ok: true; brief: SiteBrief }[], waitForText: string) {
  mockGetSiteBriefAction.mockReset()
  responses.forEach((r) => mockGetSiteBriefAction.mockResolvedValueOnce(r))
  render(<SiteBriefButton siteId={SITE_ID} mode="visit" />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /préparer ma visite/i }))
  })
  await screen.findByText(waitForText)
}

describe('SiteBriefButton — Débrief vivant — À traiter', () => {
  it('1. Action ouverte (to_handle) → rendue dans « À traiter »', async () => {
    await openBrief()
    const section = sectionByHeading('À traiter')
    expect(within(section).getByText('Réparer la clôture Nord')).toBeInTheDocument()
  })

  it('3. Échéance to_plan (to_handle) → rendue dans « À traiter »', async () => {
    await openBrief()
    const section = sectionByHeading('À traiter')
    expect(within(section).getByText('Envoyer le DOE')).toBeInTheDocument()
  })

  it('4. Réserve ouverte (to_handle) → rendue dans « À traiter »', async () => {
    await openBrief()
    const section = sectionByHeading('À traiter')
    expect(within(section).getByText('Rejointoyer le carrelage hall')).toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant — Traité récemment', () => {
  it('2. Action terminée récemment (recently_handled) → rendue dans « Traité récemment »', async () => {
    await openBrief()
    const section = sectionByHeading('Traité récemment')
    expect(within(section).getByText('Nettoyer la base vie')).toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant — affordance « Vu »', () => {
  it("5. Signal informationnel non vu (to_watch) → rendu dans « À surveiller » AVEC un bouton Vu", async () => {
    await openBrief()
    const section = sectionByHeading('À surveiller')
    const row = within(section).getByText('Fissure façade — situation aggravée au dernier PV').closest('li')!
    expect(within(row).getByRole('button', { name: 'Vu' })).toBeInTheDocument()
  })

  it('6. Signal informationnel vu (recently_handled) → rendu dans « Traité récemment » SANS bouton Vu', async () => {
    await openBrief()
    const section = sectionByHeading('Traité récemment')
    const row = within(section).getByText('Fuite réseau EU — stagnante').closest('li')!
    expect(within(row).queryByRole('button', { name: 'Vu' })).not.toBeInTheDocument()
  })

  it('7. Aucune Action/Échéance/Réserve ne porte jamais de bouton Vu, quel que soit le bloc', async () => {
    await openBrief()
    const aTraiter = sectionByHeading('À traiter') // actionOpen + deadlineToPlan + reserveOpen
    expect(within(aTraiter).queryByRole('button', { name: 'Vu' })).not.toBeInTheDocument()
    const traiteRecemment = sectionByHeading('Traité récemment') // actionDoneRecent + signalSeen
    const actionRow = within(traiteRecemment).getByText('Nettoyer la base vie').closest('li')!
    expect(within(actionRow).queryByRole('button', { name: 'Vu' })).not.toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant — liens réels', () => {
  it('8. Chaque item pointe vers la route réelle de son objet (jamais un lien factice)', async () => {
    await openBrief()
    expect(screen.getByRole('link', { name: 'Réparer la clôture Nord' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}/action/act-open-1`,
    )
    expect(screen.getByRole('link', { name: 'Rejointoyer le carrelage hall' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}/reserve/res-1`,
    )
    expect(screen.getByRole('link', { name: 'Envoyer le DOE' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}?tab=planning&plantab=echeances`,
    )
    expect(
      screen.getByRole('link', { name: 'Fissure façade — situation aggravée au dernier PV' }),
    ).toHaveAttribute('href', `/sites/${SITE_ID}/subjects/cs-1`)
  })
})

describe('SiteBriefButton — Débrief vivant — première visite', () => {
  it("9. sinceLastVisit.kind === 'first_visit' → message « Première visite », pas de section delta vide/cassée", async () => {
    await openBrief(makeLiveDebrief({ sinceLastVisit: { kind: 'first_visit' } }))
    const section = sectionByHeading('Depuis votre dernière venue')
    expect(within(section).getByText(/première visite/i)).toBeInTheDocument()
    expect(within(section).queryByText(/depuis votre dernière venue (personnelle|connue) du/i)).not.toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant — pas de Régénérer propriétaire', () => {
  it('10. Aucun bouton Régénérer/Générer propre au LiveDebrief ; le bouton IA existant reste séparé et intact', async () => {
    await openBrief()
    for (const heading of ['À traiter', 'À surveiller', 'Traité récemment', 'Depuis votre dernière venue']) {
      const section = sectionByHeading(heading)
      expect(within(section).queryByRole('button', { name: /génér/i })).not.toBeInTheDocument()
    }
    // Le bouton Générer/Régénérer légitime (« Recommandations MemorIA », feature LLM
    // distincte hors périmètre D4) doit rester présent et fonctionnel ailleurs.
    expect(screen.getByText(/recommandations memoria/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Générer' })).toBeInTheDocument()
  })
})

// ── D5 — Débrief vivant : CTA inline (Échéances, Action, Réserve) ─────────────
// GO Vincent D5 : « le geste de planification doit faire changer de bloc
// immédiatement » — ces tests prouvent le changement de bloc après mutation
// (refetchBrief), pas seulement l'appel de la server action. Réutilise
// strictement complete/rescheduleDeadlineAction, closeActionAction,
// liftReserveAction (mockées) ; aucune nouvelle mutation métier.

describe('SiteBriefButton — Débrief vivant D5 — Échéance inline', () => {
  it('D5-1. to_plan → Planifier → quitte « À traiter », rejoint « À surveiller »', async () => {
    await openBriefSeq(
      [
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [deadlineToPlan], toWatch: [], recentlyHandled: [] })) },
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [], toWatch: [deadlinePlanned], recentlyHandled: [] })) },
      ],
      'Envoyer le DOE',
    )
    const aTraiter = sectionByHeading('À traiter')
    const row = within(aTraiter).getByText('Envoyer le DOE').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Échéance' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Planifier' }))
    })
    const dateInput = row.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer' }))
    })
    expect(mockRescheduleDeadline).toHaveBeenCalledWith({ deadlineId: 'dl-1', dueDate: '2026-09-15' })
    await waitFor(() => {
      expect(screen.queryByText('Envoyer le DOE')).not.toBeInTheDocument()
    })
    expect(within(sectionByHeading('À surveiller')).getByText('Livrer le plan de récolement')).toBeInTheDocument()
  })

  it('D5-2. planned → Marquer réalisée → quitte « À surveiller », rejoint « Traité récemment »', async () => {
    const deadlineDone: LiveDebriefItem = { ...deadlinePlanned, status: 'done', disposition: 'recently_handled' }
    await openBriefSeq(
      [
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [], toWatch: [deadlinePlanned], recentlyHandled: [] })) },
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [], toWatch: [], recentlyHandled: [deadlineDone] })) },
      ],
      'Livrer le plan de récolement',
    )
    const aSurveiller = sectionByHeading('À surveiller')
    const row = within(aSurveiller).getByText('Livrer le plan de récolement').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Échéance' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Marquer réalisée' }))
    })
    expect(mockCompleteDeadline).toHaveBeenCalledWith('dl-2')
    await waitFor(() => {
      expect(within(sectionByHeading('Traité récemment')).getByText('Livrer le plan de récolement')).toBeInTheDocument()
    })
    // Bloc « À surveiller » vidé par la mutation → section entière masquée (pas de bloc vide).
    expect(screen.queryByText('À surveiller')).not.toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant D5 — Action inline', () => {
  it('D5-3. open → Clôturer → rejoint « Traité récemment »', async () => {
    const actionClosed: LiveDebriefItem = { ...actionOpen, status: 'done', disposition: 'recently_handled' }
    await openBriefSeq(
      [
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [actionOpen], toWatch: [], recentlyHandled: [] })) },
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [], toWatch: [], recentlyHandled: [actionClosed] })) },
      ],
      'Réparer la clôture Nord',
    )
    const aTraiter = sectionByHeading('À traiter')
    const row = within(aTraiter).getByText('Réparer la clôture Nord').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Action' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Clôturer' }))
    })
    const textarea = row.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Clôture réparée et vérifiée.' } })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Clôturer' }))
    })
    expect(mockCloseAction).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(sectionByHeading('Traité récemment')).getByText('Réparer la clôture Nord')).toBeInTheDocument()
    })
  })
})

describe('SiteBriefButton — Débrief vivant D5 — Réserve inline (rôle autorisé)', () => {
  it('D5-4. open → Lever (canLiftReserve) → rejoint « Traité récemment »', async () => {
    const reserveLifted: LiveDebriefItem = { ...reserveOpen, status: 'lifted', disposition: 'recently_handled' }
    await openBriefSeq(
      [
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [reserveOpen], toWatch: [], recentlyHandled: [] })) },
        { ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [], toWatch: [], recentlyHandled: [reserveLifted] })) },
      ],
      'Rejointoyer le carrelage hall',
    )
    const aTraiter = sectionByHeading('À traiter')
    const row = within(aTraiter).getByText('Rejointoyer le carrelage hall').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Réserve' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Lever la réserve' }))
    })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Lever' }))
    })
    expect(mockLiftReserve).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(sectionByHeading('Traité récemment')).getByText('Rejointoyer le carrelage hall')).toBeInTheDocument()
    })
  })

  it("D5-5. open, rôle non autorisé (canLiftReserve=false) → pas de bouton Lever, lien vers la fiche conservé (« Ouvrir »)", async () => {
    await openBriefSeq(
      [
        {
          ok: true,
          brief: makeBrief(makeLiveDebrief({ toHandle: [reserveOpen], toWatch: [], recentlyHandled: [] }), false),
        },
      ],
      'Rejointoyer le carrelage hall',
    )
    const section = sectionByHeading('À traiter')
    expect(within(section).queryByRole('button', { name: 'Lever' })).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Rejointoyer le carrelage hall' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}/reserve/res-1`,
    )
  })

  // Bug réel signalé par Vincent : au clic sur Lever, « aucun changement observable ».
  // Cause racine identifiée = reserveOnSite() interrogeait la mauvaise table
  // (site_reserves au lieu de site_reserve), donc liftReserveAction échouait
  // TOUJOURS avant d'écrire quoi que ce soit. Ce test verrouille le contrat côté
  // UI : un échec de mutation doit rester visible dans le formulaire, pas
  // silencieux, et ne doit ni faire disparaître la réserve ni appeler refetchBrief.
  it('D5-6. échec de la mutation (Réserve introuvable) → erreur visible inline, réserve reste dans « À traiter »', async () => {
    mockLiftReserve.mockResolvedValueOnce({ error: 'Réserve introuvable' })
    await openBriefSeq(
      [{ ok: true, brief: makeBrief(makeLiveDebrief({ toHandle: [reserveOpen], toWatch: [], recentlyHandled: [] })) }],
      'Rejointoyer le carrelage hall',
    )
    const aTraiter = sectionByHeading('À traiter')
    const row = within(aTraiter).getByText('Rejointoyer le carrelage hall').closest('li')!
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Réserve' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Lever la réserve' }))
    })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Lever' }))
    })
    expect(mockLiftReserve).toHaveBeenCalled()
    expect(await within(row).findByRole('alert')).toHaveTextContent('Réserve introuvable')
    // Un seul appel getSiteBriefAction (l'ouverture) : la mutation en échec n'a pas déclenché refetchBrief.
    expect(mockGetSiteBriefAction).toHaveBeenCalledTimes(1)
    expect(within(aTraiter).getByText('Rejointoyer le carrelage hall')).toBeInTheDocument()
  })
})

describe('SiteBriefButton — Débrief vivant D5 — Traité récemment reste lecture seule', () => {
  it('D5-6. Aucun CTA (Planifier/Marquer réalisée/Clôturer/Lever) sur un item déjà traité', async () => {
    await openBrief()
    const section = sectionByHeading('Traité récemment')
    expect(within(section).queryByRole('button', { name: 'Planifier' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Marquer réalisée' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Clôturer' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Lever' })).not.toBeInTheDocument()
  })
})

// D7 §2 — « Traité récemment » reste court par défaut : au-delà de 3 éléments,
// seuls les 3 plus récents (ordre déjà fourni par LiveDebrief, jamais retrié
// ici) sont visibles, avec un dépli local sans action métier ni persistance.
describe('SiteBriefButton — Débrief vivant D7 §2 — Traité récemment plafonné', () => {
  const manyRecentlyHandled: LiveDebriefItem[] = [
    actionDoneRecent,
    signalSeen,
    { ...actionDoneRecent, id: 'act-done-2', title: 'Ranger le dépôt matériel' },
    { ...actionDoneRecent, id: 'act-done-3', title: 'Baliser la zone Sud' },
  ]

  it('D7-2a. > 3 éléments → seuls les 3 premiers rendus, avec « Voir les 4 éléments »', async () => {
    await openBrief(makeLiveDebrief({ recentlyHandled: manyRecentlyHandled }))
    const section = sectionByHeading('Traité récemment')
    expect(within(section).getByText('Nettoyer la base vie')).toBeInTheDocument()
    expect(within(section).getByText('Fuite réseau EU — stagnante')).toBeInTheDocument()
    expect(within(section).getByText('Ranger le dépôt matériel')).toBeInTheDocument()
    expect(within(section).queryByText('Baliser la zone Sud')).not.toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Voir les 4 éléments' })).toBeInTheDocument()
  })

  it("D7-2b. clic sur « Voir les 4 éléments » → tous les éléments rendus, bouton disparaît", async () => {
    await openBrief(makeLiveDebrief({ recentlyHandled: manyRecentlyHandled }))
    const section = sectionByHeading('Traité récemment')
    fireEvent.click(within(section).getByRole('button', { name: 'Voir les 4 éléments' }))
    expect(within(section).getByText('Baliser la zone Sud')).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /voir les/i })).not.toBeInTheDocument()
  })

  it('D7-2c. ≤ 3 éléments (défaut) → jamais de bouton « Voir les N éléments »', async () => {
    await openBrief()
    const section = sectionByHeading('Traité récemment')
    expect(within(section).queryByRole('button', { name: /voir les/i })).not.toBeInTheDocument()
  })
})
