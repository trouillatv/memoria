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
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import type { SiteBrief } from '@/app/(dashboard)/sites/[id]/site-brief-actions'
import type { LiveDebrief, LiveDebriefItem } from '@/lib/knowledge/live-debrief'

const SITE_ID = '33333333-3333-3333-3333-333333333333'

const { mockGetSiteBriefAction, mockMarkSeen } = vi.hoisted(() => ({
  mockGetSiteBriefAction: vi.fn(),
  mockMarkSeen: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('@/app/(dashboard)/sites/[id]/site-brief-actions', () => ({
  getSiteBriefAction: mockGetSiteBriefAction,
  logBriefOpenAction: vi.fn(async () => {}),
  generateDiscussionPointsAction: vi.fn(async () => ({ ok: true as const, points: [], mock: false, hadInput: false })),
}))

vi.mock('@/app/(dashboard)/sites/[id]/live-debrief-signal-actions', () => ({
  markLiveDebriefSignalSeenAction: mockMarkSeen,
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

function makeBrief(liveDebrief: LiveDebrief): SiteBrief {
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
