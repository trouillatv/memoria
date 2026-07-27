// Contexte opérationnel d'un acteur (V2.2) — logique PURE : « le dernier événement
// de chaque type » + une frise condensée du plus récent. Doctrine : jamais un
// compteur, jamais une invention ; on ordonne des événements DÉJÀ datés.

import { describe, expect, it } from 'vitest'
import { buildActorContext, type ActorContextEvent } from '@/lib/db/actor-context'

const ev = (kind: ActorContextEvent['kind'], date: string, label: string): ActorContextEvent => ({ kind, date, label, sub: null, href: null })

describe('buildActorContext', () => {
  it('dernières interactions : le DERNIER événement de chaque type présent', () => {
    const { latest } = buildActorContext([
      ev('action', '2026-07-10', 'Vieille action'),
      ev('action', '2026-07-20', 'Action récente'),
      ev('report', '2026-07-24', 'Cité dans une visite'),
      ev('decision', '2026-07-18', 'Commande menuiseries'),
    ])
    // Ordre de lecture fixe : report, decision, action, casting, team.
    expect(latest.map((e) => e.kind)).toEqual(['report', 'decision', 'action'])
    // Pour « action », c'est bien la PLUS RÉCENTE (pas un compteur, pas la première).
    expect(latest.find((e) => e.kind === 'action')?.label).toBe('Action récente')
  })

  it('chronologie condensée : triée du plus récent, plafonnée à 6', () => {
    const many = Array.from({ length: 9 }, (_, i) => ev('action', `2026-07-0${i + 1}`, `A${i + 1}`))
    const { timeline } = buildActorContext(many)
    expect(timeline).toHaveLength(6)
    expect(timeline[0]!.label).toBe('A9')       // le plus récent d'abord
    expect(timeline[5]!.label).toBe('A4')       // 6 plus récents seulement
  })

  it('aucun événement → contexte vide (rien à inventer)', () => {
    expect(buildActorContext([])).toEqual({ latest: [], timeline: [] })
  })
})
