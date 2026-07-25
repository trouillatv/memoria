import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Situation } from '@/lib/situations/situation'
import { projectAttentionCards, projectSituationForAttention } from '@/lib/situations/attention/project'

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

    const card = projectSituationForAttention(situation)

    expect(card).toEqual({
      id: 'signal-1',
      icon: 'calendar',
      tone: 'amber',
      title: 'Planning toujours non diffusé',
      description: 'Annonce faite lors de la visite du 21 juillet.',
      siteLabel: 'Lycée PETRO ATTITI',
      organizationLabel: 'Demo Org',
      timingLabel: 'Échéance dépassée depuis 19 jours',
      sourceLabel: 'Visite du 21 juillet',
      primaryAction: { kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' },
      secondaryActions: [],
    })

    expect(situation).toEqual(snapshot)
  })

  it('projette une promesse sans date sans introduire de retard', () => {
    const situation = baseSituation({
      id: 'signal-2',
      kind: 'unconfirmed_promise',
      severity: 'info',
      title: 'Annonce à confirmer',
      explanation: 'Aucune échéance structurée n’est disponible pour cette annonce.',
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

    const card = projectSituationForAttention(situation)

    expect(card).toEqual({
      id: 'signal-2',
      icon: 'question',
      tone: 'neutral',
      title: 'Annonce à confirmer',
      description: 'Aucune échéance structurée n’est disponible pour cette annonce.',
      siteLabel: 'CAFAT Centre-ville',
      timingLabel: 'Aucune confirmation depuis 15 jours',
      primaryAction: undefined,
      secondaryActions: [],
    })
    expect(card?.title).not.toMatch(/retard|échue/i)
    expect(card?.timingLabel).not.toMatch(/retard|échue/i)
  })

  it('ignore proprement une situation inconnue', () => {
    const unknown = {
      ...baseSituation(),
      kind: 'question' as never,
    }

    expect(projectSituationForAttention(unknown as Situation)).toBeNull()
    expect(projectAttentionCards([null, unknown as Situation, baseSituation()])).toHaveLength(1)
  })

  it('n’ajoute aucune action si aucune capability n’existe', () => {
    const situation = baseSituation({ capabilities: [] })
    const card = projectSituationForAttention(situation)

    expect(card?.primaryAction).toBeUndefined()
    expect(card?.secondaryActions).toEqual([])
  })

  it('ne dépend pas de MemorySignal ni de facts, trigger, category ou reason', () => {
    const source = readFileSync('lib/situations/attention/project.ts', 'utf8')
    expect(source).not.toMatch(/MemorySignal|facts|trigger|category|reason/)
  })
})
