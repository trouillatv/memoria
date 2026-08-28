// #230 Lot B — cap global de densité + libellés d'activité (pur).

import { describe, it, expect } from 'vitest'
import { distributeActivityLines, activityLineText, ACTIVITY_LINE_CAP, type ActivityItem } from './site-activity'

const item = (label: string): ActivityItem => ({ canonicalSubjectId: `cs-${label}`, label, trajectory: null, href: `#${label}` })
const mk = (category: 'réouvert' | 'aggravé' | 'nouveau' | 'réapparu' | 'résolu' | 'autre', n: number) =>
  ({ category, total: n, items: Array.from({ length: n }, (_, i) => item(`${category}${i}`)) })

describe('distributeActivityLines — cap global + priorité', () => {
  it('remplit par priorité réouvert > aggravé > nouveau > réapparu > résolu', () => {
    const g = distributeActivityLines([mk('résolu', 15), mk('nouveau', 7), mk('réouvert', 1)], 8)
    const byCat = Object.fromEntries(g.map((x) => [x.category, x]))
    expect(byCat['réouvert'].displayed).toHaveLength(1)   // priorité 1 : tout affiché
    expect(byCat['nouveau'].displayed).toHaveLength(7)    // reste 7 places
    expect(byCat['résolu'].displayed).toHaveLength(0)     // cap épuisé
    expect(byCat['résolu'].total).toBe(15)                // mais total exact conservé
    expect(byCat['résolu'].hiddenCount).toBe(15)
  })

  it('« + N autres » : total exhaustif même si liste tronquée', () => {
    const g = distributeActivityLines([mk('nouveau', 12)], 8)
    expect(g[0].displayed).toHaveLength(8)
    expect(g[0].total).toBe(12)
    expect(g[0].hiddenCount).toBe(4) // « +4 autres »
  })

  it('cap par défaut = 8', () => {
    const g = distributeActivityLines([mk('nouveau', 20)])
    expect(g[0].displayed).toHaveLength(ACTIVITY_LINE_CAP)
  })

  it('sous le cap → tout affiché, hiddenCount=0', () => {
    const g = distributeActivityLines([mk('réouvert', 3), mk('nouveau', 2)], 8)
    expect(g.find((x) => x.category === 'réouvert')!.displayed).toHaveLength(3)
    expect(g.find((x) => x.category === 'nouveau')!.displayed).toHaveLength(2)
    expect(g.every((x) => x.hiddenCount === 0)).toBe(true)
  })
})

describe('activityLineText', () => {
  it('réouvert → « Résolu précédemment → à refaire »', () => {
    expect(activityLineText('réouvert')).toBe('Résolu précédemment → à refaire')
  })
  it('réapparu ≠ nouveau ≠ réouvert (3 films distincts)', () => {
    expect(activityLineText('réapparu')).toMatch(/réapparu/i)
    expect(activityLineText('nouveau')).toBeNull() // entête « N nouveaux » suffit
    expect(activityLineText('réapparu')).not.toBe(activityLineText('réouvert'))
  })
})
