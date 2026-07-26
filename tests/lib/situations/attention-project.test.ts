import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Situation } from '@/lib/situations/situation'
import type { AttentionCard, AttentionTone } from '@/lib/situations/attention/types'
import { projectAttentionCards, projectSituationForAttention, sortAttentionCards } from '@/lib/situations/attention/project'

// Date fixe pour que les calculs de score soient déterministes dans les tests.
// dueAt du baseSituation = 2026-07-06 → 21 jours en retard → urgency 'overdue' = 25
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

    // expired_promise: impact 35 + urgency overdue 25 + staleness 0 (2j) = 60
    expect(card).toEqual({
      id: 'signal-1',
      icon: 'calendar',
      tone: 'amber',
      priority: 60,
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

  it('projette une promesse sans date — urgence none (+0)', () => {
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

    // unconfirmed_promise: impact 20 + urgency none 0 + staleness 0 (2j) = 20
    expect(card).toEqual({
      id: 'signal-2',
      icon: 'question',
      tone: 'neutral',
      priority: 20,
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

describe('priorityScore — urgence calendaire', () => {
  it("aujourd'hui (+30) > en retard (+25)", () => {
    const dueToday = baseSituation({
      timing: { ...baseSituation().timing, dueAt: '2026-07-27T08:00:00.000Z' },
    })
    const overdue = baseSituation({
      timing: { ...baseSituation().timing, dueAt: '2026-07-06T08:00:00.000Z' },
    })
    const cardToday  = projectSituationForAttention(dueToday, NOW)!
    const cardOverdue = projectSituationForAttention(overdue, NOW)!
    expect(cardToday.priority).toBeGreaterThan(cardOverdue.priority)
  })

  it("demain (+15) < en retard (+25)", () => {
    const dueTomorrow = baseSituation({
      timing: { ...baseSituation().timing, dueAt: '2026-07-28T08:00:00.000Z' },
    })
    const overdue = baseSituation()
    const cardTomorrow = projectSituationForAttention(dueTomorrow, NOW)!
    const cardOverdue  = projectSituationForAttention(overdue, NOW)!
    expect(cardOverdue.priority).toBeGreaterThan(cardTomorrow.priority)
  })

  it("sans échéance (+0) pour une promesse non confirmée", () => {
    const s = baseSituation({
      kind: 'unconfirmed_promise',
      timing: { ...baseSituation().timing, dueAt: null },
    })
    // impact 20 + urgency 0 + staleness 0 = 20
    expect(projectSituationForAttention(s, NOW)!.priority).toBe(20)
  })
})

describe('priorityScore — dimensions et ancienneté', () => {
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
      timing: { ...baseSituation().timing, detectedAt: '2026-07-10T08:00:00.000Z' }, // 17 jours
    })
    const recent = baseSituation({
      timing: { ...baseSituation().timing, detectedAt: '2026-07-25T08:00:00.000Z' }, // 2 jours
    })

    const cardOld    = projectSituationForAttention(old, NOW)!
    const cardRecent = projectSituationForAttention(recent, NOW)!

    expect(cardOld.priority).toBeGreaterThan(cardRecent.priority)
  })

  it("stale_action score moins qu'open_reserve (même ancienneté)", () => {
    const stale = baseSituation({ kind: 'stale_action', timing: { ...baseSituation().timing, dueAt: null } })
    const reserve = baseSituation({ kind: 'open_reserve', timing: { ...baseSituation().timing, dueAt: null } })

    expect(projectSituationForAttention(reserve, NOW)!.priority)
      .toBeGreaterThan(projectSituationForAttention(stale, NOW)!.priority)
  })
})

describe('priorityScore — bonus contextuel', () => {
  it("ajoute +15 quand le chantier a une activité programmée aujourd'hui", () => {
    const situation = baseSituation()
    const withBonus    = projectSituationForAttention(situation, NOW, { siteIdsToday: new Set(['site-1']) })!
    const withoutBonus = projectSituationForAttention(situation, NOW, { siteIdsToday: new Set() })!

    expect(withBonus.priority - withoutBonus.priority).toBe(15)
  })

  it("ne donne pas de bonus pour un autre chantier", () => {
    const situation = baseSituation()
    const card = projectSituationForAttention(situation, NOW, { siteIdsToday: new Set(['site-OTHER']) })!
    const cardBase = projectSituationForAttention(situation, NOW)!

    expect(card.priority).toBe(cardBase.priority)
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
