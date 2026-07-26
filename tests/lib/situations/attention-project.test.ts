import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Situation } from '@/lib/situations/situation'
import type { AttentionCard, AttentionTone } from '@/lib/situations/attention/types'
import { projectAttentionCards, projectSituationForAttention, sortAttentionCards } from '@/lib/situations/attention/project'

// Date fixe pour que les calculs de score soient déterministes dans les tests.
const NOW = new Date('2026-07-27T09:00:00.000Z')

function baseSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'signal-1',
    signalId: 'signal-1',
    kind: 'expired_promise',
    severity: 'warning',
    title: 'Planning toujours non diffusé',
    explanation: 'Annonce faite lors de la visite du 21 juillet.',
    site: {
      id: 'site-1',
      name: 'Lycée PETRO ATTITI',
      organizationId: 'org-1',
      organizationName: 'Demo Org',
    },
    timing: {
      occurredAt: '2026-07-06T08:00:00.000Z',
      dueAt: '2026-07-06T08:00:00.000Z',
      detectedAt: '2026-07-25T08:00:00.000Z',
      ageDays: 19,
      label: 'Échéance dépassée depuis 19 jours',
    },
    source: {
      type: 'visit',
      id: 'visit-1',
      label: 'Visite du 21 juillet',
      href: '/visites/visit-1',
    },
    subject: null,
    capabilities: [
      { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
    ],
    ...overrides,
  }
}

describe('projectSituationForAttention', () => {
  it('projette une promesse échue en carte Attention lisible', () => {
    const situation = baseSituation()
    const snapshot = structuredClone(situation)

    const card = projectSituationForAttention(situation, NOW)

    // expired_promise: impact 35 + urgency 20 (19j > 7) + staleness 0 (2j ≤ 2) = 55
    expect(card).toEqual({
      id: 'signal-1',
      icon: 'calendar',
      tone: 'amber',
      priority: 55,
      title: 'Planning toujours non diffusé',
      description: 'Annonce faite lors de la visite du 21 juillet.',
      siteLabel: 'Lycée PETRO ATTITI',
      organizationLabel: 'Demo Org',
      timingLabel: 'Échéance dépassée depuis 19 jours',
      sourceLabel: 'Visite du 21 juillet',
      primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
      secondaryActions: [],
      subject: null,
      resolutions: [],
    })

    expect(situation).toEqual(snapshot)
  })

  it('projette une promesse sans date sans introduire de retard', () => {
    const situation = baseSituation({
      id: 'signal-2',
      kind: 'unconfirmed_promise',
      severity: 'info',
      title: 'Annonce à confirmer',
      explanation: "Aucune échéance structurée n'est disponible pour cette annonce.",
      site: {
        id: 'site-2',
        name: 'CAFAT Centre-ville',
        organizationId: 'org-2',
        organizationName: null,
      },
      timing: {
        occurredAt: '2026-07-10T08:00:00.000Z',
        dueAt: null,
        detectedAt: '2026-07-25T08:00:00.000Z',
        ageDays: 15,
        label: 'Aucune confirmation depuis 15 jours',
      },
      source: null,
      capabilities: [],
    })

    const card = projectSituationForAttention(situation, NOW)

    // unconfirmed_promise: impact 20 + urgency 20 (15j > 7) + staleness 0 (2j ≤ 2) = 40
    expect(card).toEqual({
      id: 'signal-2',
      icon: 'question',
      tone: 'neutral',
      priority: 40,
      title: 'Annonce à confirmer',
      description: "Aucune échéance structurée n'est disponible pour cette annonce.",
      siteLabel: 'CAFAT Centre-ville',
      timingLabel: 'Aucune confirmation depuis 15 jours',
      primaryAction: undefined,
      secondaryActions: [],
      subject: null,
      resolutions: [],
    })
    expect(card?.title).not.toMatch(/retard|échue/i)
    expect(card?.timingLabel).not.toMatch(/retard|échue/i)
  })

  it('ignore proprement une situation inconnue', () => {
    const unknown = {
      ...baseSituation(),
      kind: 'question' as never,
    }

    expect(projectSituationForAttention(unknown as Situation, NOW)).toBeNull()
    expect(projectAttentionCards([null, unknown as Situation, baseSituation()], NOW)).toHaveLength(1)
  })

  it("n'ajoute aucune action si aucune capability n'existe", () => {
    const situation = baseSituation({ capabilities: [] })
    const card = projectSituationForAttention(situation, NOW)

    expect(card?.primaryAction).toBeUndefined()
    expect(card?.secondaryActions).toEqual([])
  })

  it("ne dépend pas de MemorySignal ni de facts, trigger, category ou reason", () => {
    const source = readFileSync('lib/situations/attention/project.ts', 'utf8')
    expect(source).not.toMatch(/MemorySignal|facts|trigger|category|reason/)
  })
})

describe('priorityScore — score métier', () => {
  it("overdue_action avec long retard score plus haut qu'une promesse récente", () => {
    const overdueOld = baseSituation({
      kind: 'overdue_action',
      severity: 'critical',
      timing: { ...baseSituation().timing, ageDays: 35, detectedAt: '2026-07-10T08:00:00.000Z' },
    })
    const freshPromise = baseSituation({
      kind: 'expired_promise',
      severity: 'warning',
      timing: { ...baseSituation().timing, ageDays: 2, detectedAt: '2026-07-26T08:00:00.000Z' },
    })

    const cardOverdue = projectSituationForAttention(overdueOld, NOW)!
    const cardFresh   = projectSituationForAttention(freshPromise, NOW)!

    expect(cardOverdue.priority).toBeGreaterThan(cardFresh.priority)
  })

  it('même type, signal plus ancien → score plus élevé', () => {
    const old = baseSituation({
      timing: { ...baseSituation().timing, ageDays: 19, detectedAt: '2026-07-10T08:00:00.000Z' }, // 17 jours
    })
    const recent = baseSituation({
      timing: { ...baseSituation().timing, ageDays: 19, detectedAt: '2026-07-25T08:00:00.000Z' }, // 2 jours
    })

    const cardOld    = projectSituationForAttention(old, NOW)!
    const cardRecent = projectSituationForAttention(recent, NOW)!

    expect(cardOld.priority).toBeGreaterThan(cardRecent.priority)
  })

  it("stale_action avec retard modéré score moins qu'open_reserve", () => {
    const stale = baseSituation({ kind: 'stale_action', timing: { ...baseSituation().timing, ageDays: 5 } })
    const reserve = baseSituation({ kind: 'open_reserve', timing: { ...baseSituation().timing, ageDays: 5 } })

    const cardStale   = projectSituationForAttention(stale, NOW)!
    const cardReserve = projectSituationForAttention(reserve, NOW)!

    expect(cardReserve.priority).toBeGreaterThan(cardStale.priority)
  })
})

describe('sortAttentionCards', () => {
  const card = (id: string, tone: AttentionTone, priority: number): AttentionCard => ({
    id, icon: 'warning', tone, title: id, description: null, siteLabel: 'site', secondaryActions: [],
    subject: null, resolutions: [], priority,
  })

  it('priorité décroissante — le score prime sur la couleur', () => {
    const sorted = sortAttentionCards([
      card('low-red',    'red',     30),
      card('high-amber', 'amber',   80),
      card('mid-red',    'red',     55),
      card('low-neutral','neutral', 20),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['high-amber', 'mid-red', 'low-red', 'low-neutral'])
  })

  it('à score égal : rouge → ambre → neutre', () => {
    const sorted = sortAttentionCards([
      card('p1-amber',   'amber',   50),
      card('a1-red',     'red',     50),
      card('p2-amber',   'amber',   50),
      card('n1-neutral', 'neutral', 50),
      card('a2-red',     'red',     50),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['a1-red', 'a2-red', 'p1-amber', 'p2-amber', 'n1-neutral'])
  })

  it("ne mute pas le tableau d'entrée", () => {
    const input = [card('a', 'neutral', 10), card('b', 'red', 80)]
    sortAttentionCards(input)
    expect(input.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
