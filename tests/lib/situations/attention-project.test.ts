import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Situation } from '@/lib/situations/situation'
import type { AttentionCard, AttentionTone } from '@/lib/situations/attention/types'
import { projectAttentionCards, projectSituationForAttention, sortAttentionCardsBySeverity } from '@/lib/situations/attention/project'

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

describe('sortAttentionCardsBySeverity', () => {
  const card = (id: string, tone: AttentionTone): AttentionCard => ({
    id, icon: 'warning', tone, title: id, description: null, siteLabel: 'site', secondaryActions: [],
    subject: null, resolutions: [],
  })

  it('rouge → ambre → neutre, tri STABLE (ordre d\'origine à sévérité égale)', () => {
    const sorted = sortAttentionCardsBySeverity([
      card('p1-amber', 'amber'), card('a1-red', 'red'), card('p2-amber', 'amber'),
      card('n1-neutral', 'neutral'), card('a2-red', 'red'),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['a1-red', 'a2-red', 'p1-amber', 'p2-amber', 'n1-neutral'])
  })

  it('ne mute pas le tableau d\'entrée', () => {
    const input = [card('a', 'neutral'), card('b', 'red')]
    sortAttentionCardsBySeverity(input)
    expect(input.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
