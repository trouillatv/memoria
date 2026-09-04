// WOW-1 — intégration du Débrief reconnecté (registres SUJET-FIRST) dans la surface réelle
// « À savoir avant d'y aller » (SiteBriefButton). La classification (category / displayState / ACK
// épisode / CBO durables) est prouvée côté read-model dans tests/knowledge/live-debrief.test.ts et
// tests/lib/wow1-debrief-registers.test.ts. Ce fichier prouve que l'UI restitue fidèlement
// `liveDebrief.registers` : partition unique par category, `reopened` en badge transversal (jamais
// une 2e partition, un sujet une seule fois), silence énoncé factuellement, dormants repliés,
// drill-down = CBO durables (lecture → fiche) + objets 1:1 actionnables, « Vu » épisode-aware, et
// axe personnel « Depuis votre dernière venue » distinct. Jamais le mur des formulations brutes.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import type { SiteBrief } from '@/app/(dashboard)/sites/[id]/site-brief-actions'
import type { LiveDebrief, LiveDebriefItem, DebriefRegisterItem } from '@/lib/knowledge/live-debrief'

const SITE_ID = '33333333-3333-3333-3333-333333333333'

const { mockGetSiteBriefAction, mockMarkSeen, mockLiftReserve } = vi.hoisted(() => ({
  mockGetSiteBriefAction: vi.fn(),
  mockMarkSeen: vi.fn(async (_item: { signalKey: string }) => ({ ok: true as const })),
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
  completeDeadlineAction: vi.fn(async () => ({ ok: true as const })),
  rescheduleDeadlineAction: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('@/app/(dashboard)/actions/actions', () => ({ closeActionAction: vi.fn(async () => ({ ok: true as const })) }))
vi.mock('@/app/(dashboard)/sites/[id]/reserves/actions', () => ({ liftReserveAction: mockLiftReserve }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// ── Fixtures registres ──────────────────────────────────────────────────────────

const reserveInline: LiveDebriefItem = {
  kind: 'reserve', id: 'res-1', title: 'Rejointoyer le carrelage hall', status: 'open',
  disposition: 'to_handle', date: '2026-08-10', canonicalSubjectId: 'cs-watch', reportId: null,
  href: `/sites/${SITE_ID}/reserve/res-1`,
}
const actionRecent: LiveDebriefItem = {
  kind: 'action', id: 'act-done-1', title: 'Nettoyer la base vie', status: 'done',
  disposition: 'recently_handled', date: '2026-08-25', canonicalSubjectId: null, reportId: null,
  href: `/sites/${SITE_ID}/action/act-done-1`,
}

const reg = (o: Partial<DebriefRegisterItem> & Pick<DebriefRegisterItem, 'canonicalSubjectId' | 'title' | 'register'>): DebriefRegisterItem => ({
  category: o.register,
  reopened: false,
  signalKey: `${o.canonicalSubjectId}:stagnant`,
  ack: 'unseen',
  pvSinceLastMention: 0,
  lastSeenAt: '2026-07-22',
  reasons: ['Mentionné dans 5 rapports'],
  href: `/sites/${SITE_ID}/historique/sujets/${o.canonicalSubjectId}`,
  durableObjects: [],
  inlineObjects: [],
  ...o,
})

// Sprinkler : dormant + Réouvert, drill-down = 2 CBO durables (jamais 35 formulations).
const sprinkler = reg({
  canonicalSubjectId: 'cs-spk', title: 'Système Sprinkler', register: 'dormant', reopened: true,
  reasons: ['Mentionné dans 8 rapports · aucune évolution depuis 320 j'],
  durableObjects: [
    { cboId: 'cbo-1', title: 'Modification du réseau sprinkler', state: 'open', conflict: false, divergence: false, href: `/sites/${SITE_ID}/historique/sujets/cs-spk` },
    { cboId: 'cbo-2', title: 'Évacuer les batteries du local sprinkler', state: 'open', conflict: false, divergence: false, href: `/sites/${SITE_ID}/historique/sujets/cs-spk` },
  ],
})
// Silence documentaire + Réouvert (un SEUL sujet, une SEULE carte, badge Réouvert dans Silence).
const bacs = reg({
  canonicalSubjectId: 'cs-bacs', title: 'Bacs de rétention produits chimiques', register: 'documentary_silence',
  reopened: true, pvSinceLastMention: 7, lastSeenAt: '2025-01-29', signalKey: 'cs-bacs:open_with_objects:2025-01-29',
  durableObjects: [{ cboId: 'cbo-b', title: 'Mettre en place des bacs de rétention', state: 'open', conflict: false, divergence: false, href: `/sites/${SITE_ID}/historique/sujets/cs-bacs` }],
})
const watch = reg({
  canonicalSubjectId: 'cs-watch', title: 'Désenfumage réserve 2', register: 'watch',
  inlineObjects: [reserveInline],
})
const dormantA = reg({ canonicalSubjectId: 'cs-d1', title: 'Plans de sécurité', register: 'dormant' })
const dormantB = reg({ canonicalSubjectId: 'cs-d2', title: 'Registre de sécurité', register: 'dormant' })

function makeLiveDebrief(overrides: Partial<LiveDebrief> = {}): LiveDebrief {
  return {
    siteId: SITE_ID,
    confirmedToday: { actionsActive: 1, actionsOverdue: 0, deadlinesToPlan: 0, deadlinesPlanned: 0, reservesOpen: 1, nextEvent: null },
    sinceLastVisit: {
      kind: 'delta', at: '2026-08-20T08:00:00.000Z', visitDateLabel: '20 août', daysAgo: 10, personal: true,
      items: [{ kind: 'action_done', label: 'Peinture hall terminée', at: '2026-08-22T08:00:00.000Z' }], overflow: 0,
    },
    toHandle: [], toWatch: [], recentlyHandled: [actionRecent], recentActivity: [], reopenedSubjectIds: ['cs-spk', 'cs-bacs'],
    registers: [sprinkler, bacs, watch, dormantA, dormantB], // act_now vide par défaut (cas RUS)
    ...overrides,
  }
}

function makeBrief(liveDebrief: LiveDebrief, canLiftReserve = true): SiteBrief {
  return {
    siteName: 'Chantier Test', contractName: null,
    situation: { openActions: 0, openAnomalies: 0, nextScheduledAt: null, passagesThisMonth: 0 },
    vigilance: [], openActions: [], recentDoneActions: [], anomaliesOpen: [], aSavoir: [], recurring: [], teams: [],
    missionNames: [], recentPhotosCount: 0, meetings: [], openReserves: [], lastReport: null, changeSinceLastReport: null,
    followedPoints: [], phase: 'follow_up', phaseLabel: 'Suivi', minuteSummary: [], urgentItems: [], blockedItems: [],
    lastPresence: null, activities: [], persistedNarrative: null, sinceLastVenue: null, changedSinceVenue: [],
    beforeLeaving: [], verificationQuestions: [], deadlines: [], decisions: [], narratives: [], proofs: [], objective: null,
    estimatedPhase: 'follow_up', freshness: { days: 0, label: "aujourd'hui", level: 'recent', at: null }, freshnessKind: null,
    coherenceInsights: [], rememberToday: [], completedSinceVenue: [], unknowns: [], openActivityItems: [],
    activityReadModel: { interventionStarted: null, dayIndex: null, activitiesInProgress: [], activitiesStartedRecently: [], stillOpen: [], toReconfirm: [] },
    liveDebrief, canLiftReserve,
  }
}

async function openBrief(liveDebrief: LiveDebrief = makeLiveDebrief()) {
  mockGetSiteBriefAction.mockResolvedValue({ ok: true, brief: makeBrief(liveDebrief) })
  render(<SiteBriefButton siteId={SITE_ID} mode="visit" />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /préparer ma visite/i })) })
  await screen.findByText('Depuis votre dernière venue')
}

describe('WOW-1 — Debrief registres sujet-first', () => {
  it('act_now=0 → bandeau « Rien d’urgent aujourd’hui », aucune section « À traiter maintenant »', async () => {
    await openBrief()
    expect(screen.getByText(/Rien d.?urgent aujourd/i)).toBeTruthy()
    expect(screen.queryByText('À traiter maintenant')).toBeNull()
  })

  it('bandeau saillant : N réouverts + N plus mentionnés (lecture remise à niveau)', async () => {
    await openBrief()
    const headline = screen.getByText(/Rien d.?urgent aujourd/i).textContent ?? ''
    expect(headline).toMatch(/2 réouverts/)
    expect(headline).toMatch(/1 plus mentionné/)
  })

  it('act_now>0 → section « À traiter maintenant » présente', async () => {
    const actNow = reg({ canonicalSubjectId: 'cs-an', title: 'NC critique', register: 'act_now', signalKey: 'cs-an:pv_non_conforme' })
    await openBrief(makeLiveDebrief({ registers: [actNow, watch] }))
    expect(screen.getByText('À traiter maintenant')).toBeTruthy()
  })

  it('silence : énoncé factuel « Plus mentionné depuis N PV », jamais « toujours ouvert »', async () => {
    await openBrief()
    const section = screen.getByText('Silence documentaire').closest('section') as HTMLElement
    expect(within(section).getByText(/Plus mentionné depuis 7 PV/)).toBeTruthy()
    expect(within(section).queryByText(/toujours ouvert/i)).toBeNull()
  })

  it('un sujet réouvert-et-silencieux apparaît UNE seule fois (badge Réouvert dans Silence), pas de 2e partition', async () => {
    await openBrief()
    expect(screen.queryByText('Réouverts')).toBeNull() // pas de registre « Réouverts » concurrent
    const bacsLink = screen.getByText('Bacs de rétention produits chimiques')
    const card = bacsLink.closest('li') as HTMLElement
    expect(within(card).getByText('Réouvert')).toBeTruthy()
    expect(screen.getAllByText('Bacs de rétention produits chimiques')).toHaveLength(1)
  })

  it('dormants repliés par défaut (pas de mur de cartes), dépliables', async () => {
    await openBrief()
    expect(screen.queryByText('Plans de sécurité')).toBeNull() // replié
    fireEvent.click(screen.getByText('Dormants').closest('button')!)
    expect(screen.getByText('Plans de sécurité')).toBeTruthy()
    expect(screen.getByText('Registre de sécurité')).toBeTruthy()
  })

  it('drill-down : CBO durables (lecture → fiche), jamais les formulations brutes', async () => {
    await openBrief()
    fireEvent.click(screen.getByText('Dormants').closest('button')!) // Sprinkler est dormant (replié)
    const card = screen.getByText('Système Sprinkler').closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /détailler/i }))
    expect(within(card).getByText(/À piloter/)).toBeTruthy()
    expect(within(card).getByText('Modification du réseau sprinkler')).toBeTruthy()
    expect(within(card).getByText('Évacuer les batteries du local sprinkler')).toBeTruthy()
  })

  it('drill-down : objet 1:1 (réserve) reste actionnable avec son geste', async () => {
    await openBrief()
    const card = screen.getByText('Désenfumage réserve 2').closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /détailler/i }))
    expect(within(card).getByText('Rejointoyer le carrelage hall')).toBeTruthy()
  })

  it('« Vu » sur une carte registre → ACK épisode-aware (signalKey du silence transmis)', async () => {
    await openBrief()
    const card = screen.getByText('Bacs de rétention produits chimiques').closest('li') as HTMLElement
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /^vu$/i })) })
    expect(mockMarkSeen).toHaveBeenCalled()
    const arg = mockMarkSeen.mock.calls[0][0] as { signalKey: string }
    expect(arg.signalKey).toBe('cs-bacs:open_with_objects:2025-01-29')
  })

  it('axe personnel « Depuis votre dernière venue » distinct + « Traité récemment » conservé', async () => {
    await openBrief()
    expect(screen.getByText('Depuis votre dernière venue')).toBeTruthy()
    expect(screen.getByText('Peinture hall terminée')).toBeTruthy()
    expect(screen.getByText('Traité récemment')).toBeTruthy()
    expect(screen.getByText('Nettoyer la base vie')).toBeTruthy()
  })

  it('aucun bouton « Régénérer » propre au Débrief (doctrine projection)', async () => {
    await openBrief()
    expect(screen.queryByRole('button', { name: /régénérer/i })).toBeNull()
  })
})
