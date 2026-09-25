// P0-3.2 (mandat Vincent 2026-09-25) — le CTA « Mettre en vigueur » n'apparaît
// que sur une carte curated ET quand canActivate=true. ActivateEngagementButton
// est un composant client à hooks : on ne l'invoque pas (comme
// AddPlannedEngagementDialog ailleurs), on vérifie sa PRÉSENCE dans l'arbre non
// monté par référence de type, sans l'appeler.

import { describe, it, expect } from 'vitest'
import { PlannedEngagementCard } from '@/components/engagements/PlannedEngagementCard'
import type { EngagementMission, PlannedEngagement } from '@/lib/db/engagements'
import type { EngagementAction } from '@/lib/db/site-action-engagement-links'
import { buildMissionHealth } from '@/lib/missions/mission-health'

function engagement(overrides: Partial<PlannedEngagement> = {}): PlannedEngagement {
  return {
    id: 'eng-1',
    shortLabel: 'Nettoyage hebdomadaire des vitres',
    category: 'frequency',
    kind: null,
    measurable: false,
    status: 'curated',
    createdAt: '2026-09-01T00:00:00Z',
    primaryProvenance: { documentId: null, documentFilename: null, pageNumber: null, excerpt: null, frequencyRaw: null },
    additionalProvenance: [],
    ...overrides,
  }
}

function containsActivateButton(node: unknown): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return false
  if (Array.isArray(node)) return node.some(containsActivateButton)
  const el = node as { type?: unknown; props?: { children?: unknown; engagementId?: unknown } }
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === 'ActivateEngagementButton') {
    return true
  }
  if (typeof el.type === 'function') return false // ne pas invoquer d'autres fonctions (hooks potentiels)
  return el.props ? containsActivateButton(el.props.children) : false
}

describe('PlannedEngagementCard — CTA « Mettre en vigueur »', () => {
  it('curated + canActivate=true : le bouton est présent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true, siteId: 'site-1', canActivate: true })
    expect(containsActivateButton(tree)).toBe(true)
  })

  it('curated + canActivate=false : le bouton est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true, siteId: 'site-1', canActivate: false })
    expect(containsActivateButton(tree)).toBe(false)
  })

  it('canActivate omis (par défaut) : le bouton est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true, siteId: 'site-1' })
    expect(containsActivateButton(tree)).toBe(false)
  })

  it('active + canActivate=true : le bouton est absent (déjà en vigueur)', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'active' }), showStatusBadge: true, siteId: 'site-1', canActivate: true })
    expect(containsActivateButton(tree)).toBe(false)
  })
})

// P0-3.5B (mandat Vincent 2026-09-26) — le CTA « Planifier » n'apparaît que
// sur une carte active ET quand canPlan=true. Même technique que ci-dessus :
// on cherche le lien par son href (`/sites/<siteId>/missions/new?engagement=<id>`)
// dans l'arbre non monté, sans invoquer de composant à hooks.
function containsPlanifierLink(node: unknown, expectedHref: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return false
  if (Array.isArray(node)) return node.some((n) => containsPlanifierLink(n, expectedHref))
  const el = node as { type?: unknown; props?: { children?: unknown; href?: unknown } }
  if (el.props && el.props.href === expectedHref) return true
  if (typeof el.type === 'function') return false // ne pas invoquer d'autres fonctions (hooks potentiels)
  return el.props ? containsPlanifierLink(el.props.children, expectedHref) : false
}

describe('PlannedEngagementCard — CTA « Planifier » (P0-3.5B)', () => {
  it('active + canPlan=true : le lien est présent avec la route site-first et l’engagement en query', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ id: 'eng-42', status: 'active' }), showStatusBadge: true, siteId: 'site-1', canPlan: true })
    expect(containsPlanifierLink(tree, '/sites/site-1/missions/new?engagement=eng-42')).toBe(true)
  })

  it('active + canPlan=false : le lien est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ id: 'eng-42', status: 'active' }), showStatusBadge: true, siteId: 'site-1', canPlan: false })
    expect(containsPlanifierLink(tree, '/sites/site-1/missions/new?engagement=eng-42')).toBe(false)
  })

  it('canPlan omis (par défaut) : le lien est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ id: 'eng-42', status: 'active' }), showStatusBadge: true, siteId: 'site-1' })
    expect(containsPlanifierLink(tree, '/sites/site-1/missions/new?engagement=eng-42')).toBe(false)
  })

  it('curated + canPlan=true : le lien est absent (pas encore en vigueur)', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ id: 'eng-42', status: 'curated' }), showStatusBadge: true, siteId: 'site-1', canPlan: true })
    expect(containsPlanifierLink(tree, '/sites/site-1/missions/new?engagement=eng-42')).toBe(false)
  })
})

// ENG-UX-1 LOT E (mandat Vincent 2026-09-26) — une fois une Mission créée, le
// CTA « Créer une mission » disparaît au profit de liens PAR Mission : « Voir
// la mission » (toujours, dès qu'une Mission existe) et « Planifier la
// prochaine intervention » (seulement si canPlan ET aucune prochaine
// occurrence connue — sinon la Mission tourne déjà, rien à planifier).
function mission(overrides: Partial<EngagementMission> = {}): EngagementMission {
  const base: EngagementMission = {
    missionId: 'mission-1',
    missionName: 'Nettoyage mensuel',
    cadence: 'monthly',
    active: true,
    assignedTeam: { id: 'team-1', name: 'Équipe A', color: null },
    lastInterventionDate: '2026-08-01',
    nextInterventionDate: null,
    openAnomalyCount: 0,
    health: buildMissionHealth(
      { active: true, cadence: 'monthly', lastInterventionDate: '2026-08-01', nextInterventionDate: null, openAnomalyCount: 0, assignedTeam: { id: 'team-1', name: 'Équipe A', color: null } },
      '2026-09-26',
    ),
    ...overrides,
  }
  return {
    ...base,
    health: buildMissionHealth(
      {
        active: base.active,
        cadence: base.cadence,
        lastInterventionDate: base.lastInterventionDate,
        nextInterventionDate: base.nextInterventionDate,
        openAnomalyCount: base.openAnomalyCount,
        assignedTeam: base.assignedTeam,
      },
      '2026-09-26',
    ),
  }
}

function containsLinkWithText(node: unknown, href: string, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return false
  if (Array.isArray(node)) return node.some((n) => containsLinkWithText(n, href, text))
  const el = node as { type?: unknown; props?: { children?: unknown; href?: unknown } }
  if (el.props && el.props.href === href) {
    return textInChildren(el.props.children, text)
  }
  if (typeof el.type === 'function') return false
  return el.props ? containsLinkWithText(el.props.children, href, text) : false
}

function textInChildren(node: unknown, text: string): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return node.includes(text)
  if (Array.isArray(node)) return node.some((n) => textInChildren(n, text))
  const el = node as { props?: { children?: unknown } }
  return el.props ? textInChildren(el.props.children, text) : false
}

describe('PlannedEngagementCard — liens par Mission (ENG-UX-1 LOT E)', () => {
  it('Mission existante : le CTA « Créer une mission » disparaît, même si canPlan=true', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission()],
    })
    expect(containsPlanifierLink(tree, '/sites/site-1/missions/new?engagement=eng-42')).toBe(false)
  })

  it('Mission existante : « Voir la mission » est présent, indépendamment de canPlan', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: false,
      missions: [mission({ missionId: 'mission-9' })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-9', 'Voir la mission')).toBe(true)
  })

  it('canPlan=true + sans prochaine intervention : « Planifier la prochaine intervention » est présent', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission({ missionId: 'mission-9', nextInterventionDate: null })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-9', 'Planifier la prochaine intervention')).toBe(true)
  })

  it('canPlan=true + prochaine intervention déjà connue : « Planifier la prochaine intervention » est absent', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission({ missionId: 'mission-9', nextInterventionDate: '2026-10-15' })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-9', 'Planifier la prochaine intervention')).toBe(false)
  })

  it('canPlan=false + sans prochaine intervention : « Planifier la prochaine intervention » est absent (droit d’organiser réservé)', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: false,
      missions: [mission({ missionId: 'mission-9', nextInterventionDate: null })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-9', 'Planifier la prochaine intervention')).toBe(false)
  })
})

// ENG-UX-1 MICRO-FIX (mandat Vincent 2026-09-26) — une Mission inactive est de
// l'historique : elle reste visible en compact mais n'organise plus rien.
describe('PlannedEngagementCard — Mission inactive (ENG-UX-1 MICRO-FIX)', () => {
  it('Mission inactive seule : le CTA « Créer une mission » réapparaît (l’inactive n’organise pas l’Engagement)', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission({ missionId: 'mission-old', active: false })],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/missions/new?engagement=eng-42', 'Créer une mission')).toBe(true)
  })

  it('Mission inactive : « Planifier la prochaine intervention » reste absent même sans prochaine occurrence connue', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission({ missionId: 'mission-old', active: false, nextInterventionDate: null })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-old', 'Planifier la prochaine intervention')).toBe(false)
  })

  it('Mission inactive : « Voir la mission » reste présent (historique visible, compact)', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      missions: [mission({ missionId: 'mission-old', active: false })],
    })
    expect(containsLinkWithText(tree, '/missions/mission-old', 'Voir la mission')).toBe(true)
  })

  it('Mission inactive + Mission active : le CTA « Créer une mission » reste absent (une organisation actuelle existe déjà)', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      canPlan: true,
      missions: [mission({ missionId: 'mission-old', active: false }), mission({ missionId: 'mission-new', active: true })],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/missions/new?engagement=eng-42', 'Créer une mission')).toBe(false)
  })
})

// ENG-UX-1 MICRO-FIX (mandat Vincent 2026-09-26) — une Action terminée ne doit
// jamais disparaître complètement de la carte Engagement.
function engagementAction(overrides: Partial<EngagementAction> & { actionId: string }): EngagementAction {
  return {
    actionId: overrides.actionId,
    title: overrides.title ?? 'Action',
    status: overrides.status ?? 'open',
    dueDate: overrides.dueDate ?? null,
    active: overrides.active ?? true,
    currentQualification: overrides.currentQualification ?? null,
  }
}

describe('PlannedEngagementCard — trace des Actions terminées (ENG-UX-1 MICRO-FIX)', () => {
  it('1 ouverte + 2 terminées : « Actions / 1 ouverte · 2 terminées »', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      actions: [
        engagementAction({ actionId: 'a1', active: true }),
        engagementAction({ actionId: 'a2', active: false, status: 'done' }),
        engagementAction({ actionId: 'a3', active: false, status: 'cancelled' }),
      ],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/actions', 'Actions / 1 ouverte · 2 terminées')).toBe(true)
  })

  it('1 Action ouverte avec qualification connue : la qualification remplace le compte brut', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      actions: [engagementAction({ actionId: 'a1', active: true, currentQualification: 'demande_evolution' })],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/actions', "Actions / 1 ouverte · Demande d'évolution")).toBe(true)
  })

  it('toutes les Actions terminées (aucune ouverte) : la trace reste visible, jamais disparue', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      actions: [engagementAction({ actionId: 'a1', active: false, status: 'done' })],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/actions', '✓ 1 action terminée')).toBe(true)
  })

  it('aucune Action liée : aucune trace affichée', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      actions: [],
    })
    expect(containsLinkWithText(tree, '/sites/site-1/actions', 'Actions /')).toBe(false)
  })

  it('même avec toutes les Actions terminées, l’Engagement n’est jamais labellisé « Traité »', () => {
    const tree = PlannedEngagementCard({
      engagement: engagement({ id: 'eng-42', status: 'active' }),
      showStatusBadge: true,
      siteId: 'site-1',
      actions: [engagementAction({ actionId: 'a1', active: false, status: 'done' })],
    })
    expect(textInChildren(tree, 'Traité')).toBe(false)
  })
})
