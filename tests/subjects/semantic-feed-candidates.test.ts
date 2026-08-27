import { describe, it, expect } from 'vitest'
import {
  buildSemanticFeedPairs,
  decideSemanticFeedMode,
  SEMANTIC_FEED_MAX_PAIRS,
  SEMANTIC_FEED_AUTO_BUDGET,
} from '@/lib/subjects/semantic-feed-candidates'
import { normalizePairKey } from '@/lib/subjects/similarity-candidates'
import { shouldPersistSemanticSuggestion } from '@/lib/subjects/similarity-analyze'
import { formatOccurrenceContext } from '@/lib/subjects/occurrence-context'

// P-UI-R2c — La voie sémantique CHOISIT les paires non lexicales à soumettre au juge.
// Le verdict/gate de persistance reste celui du cœur P-UI-R2b (shouldPersistSemanticSuggestion).

const key = normalizePairKey

describe('buildSemanticFeedPairs — sélection incrémentale des paires', () => {
  it('produit source × cible, jamais (x,x), sans doublon A/B', () => {
    const plan = buildSemanticFeedPairs({ sourceIds: ['a'], targetIds: ['a', 'b', 'c'] })
    expect(plan.capped).toBe(false)
    const keys = plan.pairs.map(([x, y]) => key(x, y)).sort()
    expect(keys).toEqual([key('a', 'b'), key('a', 'c')].sort())
    // pas de (a,a)
    expect(plan.pairs.every(([x, y]) => x !== y)).toBe(true)
    // normalisé a<b
    expect(plan.pairs.every(([x, y]) => x < y)).toBe(true)
  })

  it('INCRÉMENTAL : 3 sujets sources seulement → aucune paire entre deux cibles non-sources', () => {
    // Graphe : sources = s1,s2,s3 ; cibles supplémentaires t1..t4 (non touchées).
    const sourceIds = ['s1', 's2', 's3']
    const targetIds = [...sourceIds, 't1', 't2', 't3', 't4']
    const plan = buildSemanticFeedPairs({ sourceIds, targetIds })
    const src = new Set(sourceIds)
    // toute paire a au moins une extrémité source
    expect(plan.pairs.every(([a, b]) => src.has(a) || src.has(b))).toBe(true)
    // aucune paire purement cible↔cible (t_i, t_j)
    expect(plan.pairs.some(([a, b]) => !src.has(a) && !src.has(b))).toBe(false)
    // t1↔t2 (deux non-sources) absente
    expect(plan.pairs.map(([a, b]) => key(a, b))).not.toContain(key('t1', 't2'))
  })

  it('exclut une paire REJETÉE (mémoire des refus)', () => {
    const plan = buildSemanticFeedPairs({
      sourceIds: ['a'], targetIds: ['a', 'b', 'c'],
      excludedPairKeys: new Set([key('a', 'b')]),
    })
    expect(plan.pairs.map(([x, y]) => key(x, y))).toEqual([key('a', 'c')])
  })

  it('exclut une paire déjà PENDING (pas de doublon) et déjà FUSIONNÉE', () => {
    const plan = buildSemanticFeedPairs({
      sourceIds: ['a'], targetIds: ['a', 'b', 'c', 'd'],
      excludedPairKeys: new Set([key('a', 'b'), key('a', 'c')]),
    })
    expect(plan.pairs.map(([x, y]) => key(x, y))).toEqual([key('a', 'd')])
  })

  it('exclut les paires déjà couvertes lexicalement (union passée en excluded)', () => {
    const lexical = new Set([key('a', 'b')])
    const plan = buildSemanticFeedPairs({ sourceIds: ['a'], targetIds: ['a', 'b', 'c'], excludedPairKeys: lexical })
    expect(plan.pairs.map(([x, y]) => key(x, y))).not.toContain(key('a', 'b'))
    expect(plan.pairs.map(([x, y]) => key(x, y))).toContain(key('a', 'c'))
  })

  it('ne produit jamais une paire hors des ids fournis (acteurs absents = jamais proposés)', () => {
    // 'actor1' n'est ni source ni cible (exclu en amont : contexte business-only).
    const plan = buildSemanticFeedPairs({ sourceIds: ['a', 'b'], targetIds: ['a', 'b'] })
    const provided = new Set(['a', 'b'])
    expect(plan.pairs.every(([x, y]) => provided.has(x) && provided.has(y))).toBe(true)
    expect(plan.pairs.flat()).not.toContain('actor1')
  })

  it('> cap → SKIP total (pairs vide, capped=true), jamais une avalanche', () => {
    // 2 sources × 40 cibles = 80 paires distinctes > cap 10.
    const targetIds = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const plan = buildSemanticFeedPairs({ sourceIds: ['s0', 's1'], targetIds: ['s0', 's1', ...targetIds], cap: 10 })
    expect(plan.capped).toBe(true)
    expect(plan.pairs).toHaveLength(0)
    expect(plan.evaluatedPairCount).toBeGreaterThan(10)
  })

  it('exactement au cap → non skippé', () => {
    const plan = buildSemanticFeedPairs({ sourceIds: ['a'], targetIds: ['a', 'b', 'c'], cap: 2 })
    expect(plan.capped).toBe(false)
    expect(plan.pairs).toHaveLength(2)
  })

  it('IDEMPOTENCE : réexécution avec les paires du 1er run exclues → 0 paire', () => {
    const sourceIds = ['a']
    const targetIds = ['a', 'b', 'c']
    const run1 = buildSemanticFeedPairs({ sourceIds, targetIds })
    const persisted = new Set(run1.pairs.map(([x, y]) => key(x, y)))
    const run2 = buildSemanticFeedPairs({ sourceIds, targetIds, excludedPairKeys: persisted })
    expect(run2.pairs).toHaveLength(0)
  })

  it('cap par défaut = SEMANTIC_FEED_MAX_PAIRS', () => {
    expect(SEMANTIC_FEED_MAX_PAIRS).toBeGreaterThan(0)
    const targetIds = Array.from({ length: SEMANTIC_FEED_MAX_PAIRS + 5 }, (_, i) => `t${i}`)
    const plan = buildSemanticFeedPairs({ sourceIds: ['s'], targetIds: ['s', ...targetIds] })
    // 1 source × (SEMANTIC_FEED_MAX_PAIRS+5) cibles = trop → skip
    expect(plan.capped).toBe(true)
  })
})

describe('decideSemanticFeedMode — cadence hybride (P-UI-R2d)', () => {
  it('0 paire → none', () => {
    expect(decideSemanticFeedMode(0, false)).toBe('none')
  })
  it('≤ budget et non capped → auto', () => {
    expect(decideSemanticFeedMode(1, false)).toBe('auto')
    expect(decideSemanticFeedMode(SEMANTIC_FEED_AUTO_BUDGET, false)).toBe('auto')
  })
  it('> budget → defer (proposition explicite, aucun appel auto)', () => {
    expect(decideSemanticFeedMode(SEMANTIC_FEED_AUTO_BUDGET + 1, false)).toBe('defer')
    expect(decideSemanticFeedMode(178, false)).toBe('defer')
  })
  it('capped (au-delà du plafond dur) → defer, jamais auto', () => {
    expect(decideSemanticFeedMode(5, true)).toBe('defer')
    expect(decideSemanticFeedMode(400, true)).toBe('defer')
  })
  it('budget < plafond dur (auto strictement plus prudent que le plafond manuel)', () => {
    expect(SEMANTIC_FEED_AUTO_BUDGET).toBeLessThan(SEMANTIC_FEED_MAX_PAIRS)
  })
})

describe('gate de persistance appliqué à la voie sémantique (rappel du contrat P-UI-R2b)', () => {
  it('paire disjointe related + SOH=true → persistable', () => {
    expect(shouldPersistSemanticSuggestion('related', true)).toBe(true)
  })
  it('paire disjointe related + SOH=false → NON persistable (pas de carte fusion)', () => {
    expect(shouldPersistSemanticSuggestion('related', false)).toBe(false)
  })
  it('same_subject → persistable (à soumettre si non auto-résolu)', () => {
    expect(shouldPersistSemanticSuggestion('same_subject', false)).toBe(true)
  })
  it('distinct / uncertain → jamais persistable', () => {
    expect(shouldPersistSemanticSuggestion('distinct', false)).toBe(false)
    expect(shouldPersistSemanticSuggestion('uncertain', true)).toBe(false)
  })
})

describe('formatOccurrenceContext — contexte compact borné pour le juge', () => {
  it('joint label — note, cap le nombre par sujet', () => {
    const ctx = formatOccurrenceContext(
      [
        { label: 'Issue de secours food court', note: 'largeur non conforme' },
        { label: 'Issue de secours', note: 'reprise prévue' },
        { label: 'X', note: 'z' },
        { label: 'Y', note: 'ignoré (au-delà du cap)' },
      ],
      3, 160,
    )
    expect(ctx).toContain('Issue de secours food court — largeur non conforme')
    expect(ctx).toContain(' | ')
    expect(ctx).not.toContain('ignoré')
  })

  it('tronque une note trop longue avec …', () => {
    const long = 'a'.repeat(300)
    const ctx = formatOccurrenceContext([{ label: 'L', note: long }], 3, 50)
    expect(ctx).not.toBeNull()
    expect(ctx!.length).toBeLessThan(80)
    expect(ctx!.endsWith('…')).toBe(true)
  })

  it('dédoublonne les occurrences identiques', () => {
    const ctx = formatOccurrenceContext(
      [{ label: 'A', note: 'meme' }, { label: 'A', note: 'meme' }],
      3, 160,
    )
    expect(ctx).toBe('A — meme')
  })

  it('label seul si pas de note ; null si rien', () => {
    expect(formatOccurrenceContext([{ label: 'Seul', note: null }], 3, 160)).toBe('Seul')
    expect(formatOccurrenceContext([{ label: '', note: '' }], 3, 160)).toBeNull()
    expect(formatOccurrenceContext([], 3, 160)).toBeNull()
  })
})
