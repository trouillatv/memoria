import { describe, expect, it } from 'vitest'
import { assembleThread, type CausalNode, type CausalParts } from '@/lib/knowledge/causal-threads-model'

const node = (kind: CausalNode['kind'], label: string): CausalNode => ({ kind, label, detail: null, href: `/x?${kind}` })
const base = (o: Partial<CausalParts>): CausalParts => ({
  actionId: 'a1', action: node('action', 'Lever la réserve'), decision: null, origin: null, reserve: null, cloture: null,
  title: 'T', subtitle: null, ...o,
})
const shape = (t: ReturnType<typeof assembleThread>) => t.steps.map((s) => `${s.relationFromPrev ?? '·'}:${s.node.kind}`)

describe('assembleThread — trois relations, jamais confondues', () => {
  it('fil complet : Réunion →produit Décision →produit Action —lié Réserve →produit Levée', () => {
    const t = assembleThread(base({
      decision: { node: node('decision', 'Reprendre le câblage'), meeting: node('reunion', 'Réunion 12 juil') },
      reserve: { node: node('reserve', 'R-14'), lift: node('cloture', 'Levée + photo') },
    }))
    expect(shape(t)).toEqual(['·:reunion', 'produit:decision', 'produit:action', 'lie:reserve', 'produit:cloture'])
  })

  it('une action CONCERNE une réserve (—lié), JAMAIS « produite par » elle (garde-fou central)', () => {
    const t = assembleThread(base({ reserve: { node: node('reserve', 'R-9'), lift: null } }))
    const reserveStep = t.steps.find((s) => s.node.kind === 'reserve')!
    expect(reserveStep.relationFromPrev).toBe('lie')
    expect(reserveStep.relationFromPrev).not.toBe('produit')
  })

  it('la levée d’une réserve est bien « produit » (preuve de résolution)', () => {
    const t = assembleThread(base({ reserve: { node: node('reserve', 'R-9'), lift: node('cloture', 'Levée') } }))
    expect(t.steps.at(-1)).toMatchObject({ node: { kind: 'cloture' }, relationFromPrev: 'produit' })
  })

  it('décision sans réunion source → commence à la décision', () => {
    const t = assembleThread(base({ decision: { node: node('decision', 'D'), meeting: null } }))
    expect(shape(t)).toEqual(['·:decision', 'produit:action'])
  })

  it('pas de décision, origine visite → Visite →produit Action', () => {
    const t = assembleThread(base({ origin: node('visite', 'Visite 17 juil') }))
    expect(shape(t)).toEqual(['·:visite', 'produit:action'])
  })

  it('action clôturée sans réserve → Action →produit Clôture', () => {
    const t = assembleThread(base({ origin: node('reunion', 'R'), cloture: node('cloture', 'Clôturée 20 juil') }))
    expect(shape(t)).toEqual(['·:reunion', 'produit:action', 'produit:cloture'])
  })

  it('action orpheline (ni décision, ni origine) → le fil commence à l’action, sans amont inventé', () => {
    const t = assembleThread(base({}))
    expect(shape(t)).toEqual(['·:action'])
    expect(t.steps[0].relationFromPrev).toBeNull()
  })

  it('l’id du fil = l’action (l’engagement), jamais dérivé d’un href', () => {
    expect(assembleThread(base({ actionId: 'act-42' })).id).toBe('act-42')
  })
})
