import { describe, expect, it } from 'vitest'
import type { Situation } from '@/lib/situations/situation'
import { projectNowCards, projectSituationForNow } from '@/lib/situations/now/project'

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
    capabilities: [{ kind: 'open_source', label: 'Voir la source', href: '/visites/visit-1' }],
    ...overrides,
  }
}

describe('projectSituationForNow', () => {
  it('n’expose pas une promesse avec seulement open_source dans Now', () => {
    const situation = baseSituation()

    expect(projectSituationForNow(situation)).toBeNull()
    expect(projectNowCards([situation])).toEqual([])
  })

  it('ignore une promesse sans date de confirmation directe', () => {
    const situation = baseSituation({
      kind: 'unconfirmed_promise',
      severity: 'info',
      title: 'Annonce à confirmer',
      explanation: 'Aucune échéance structurée n’est disponible pour cette annonce.',
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

    expect(projectSituationForNow(situation)).toBeNull()
    expect(projectNowCards([null, situation])).toEqual([])
  })

  it('ignore proprement une situation inconnue', () => {
    const unknown = { ...baseSituation(), kind: 'question' as never }

    expect(projectSituationForNow(unknown as Situation)).toBeNull()
    expect(projectNowCards([null, unknown as Situation, baseSituation()])).toEqual([])
  })
})
