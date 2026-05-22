import { describe, it, expect } from 'vitest'
import type { MemorySignal, SignalKind } from '@/lib/memory/signals/types'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'
import { renderSignal } from '@/lib/memory/signals/render'
import { forSurface } from '@/lib/memory/signals/surface'

function makeSignal(kind: SignalKind, over: Partial<MemorySignal> = {}): MemorySignal {
  return {
    kind,
    subjectType: 'site',
    subjectId: 'site-1',
    subjectLabel: 'CHT Magenta',
    facts: { daysSinceLastTrace: 14, notesAdded: 3 },
    confidence: 'certain',
    detectedAt: '2026-05-22T08:00:00.000Z',
    lastRelevantEventAt: '2026-05-10',
    evidence: { rule: 'test' },
    ...over,
  }
}

describe('moteur d’états de mémoire — couche pure', () => {
  const kinds = Object.keys(SIGNAL_REGISTRY) as SignalKind[]

  it('chaque kind du registre a une famille et une valence valides', () => {
    for (const k of kinds) {
      const meta = SIGNAL_REGISTRY[k]
      expect(['attention', 'continuite', 'ao', 'memoire']).toContain(meta.family)
      expect(['fragile', 'sain', 'neutre']).toContain(meta.valence)
      expect(meta.label.length).toBeGreaterThan(0)
    }
  })

  it('chaque kind est rendu en texte FR + lien (pas de signal sans rendu)', () => {
    for (const k of kinds) {
      const r = renderSignal(makeSignal(k))
      expect(r.text.length).toBeGreaterThan(0)
      expect(r.href.startsWith('/')).toBe(true)
    }
  })

  it('au moins un kind de SANTÉ existe (pas seulement de la fragilité)', () => {
    const hasHealthy = kinds.some((k) => SIGNAL_REGISTRY[k].valence === 'sain')
    expect(hasHealthy).toBe(true)
  })

  it('le moteur naît équilibré : au moins autant de santé que de fragilité', () => {
    const sain = kinds.filter((k) => SIGNAL_REGISTRY[k].valence === 'sain').length
    const fragile = kinds.filter((k) => SIGNAL_REGISTRY[k].valence === 'fragile').length
    expect(sain).toBeGreaterThanOrEqual(fragile)
  })

  it('forSurface ordonne la fragilité avant la santé (politique dashboard)', () => {
    const signals = [
      makeSignal('fresh_field_memory', { lastRelevantEventAt: '2026-05-21' }),
      makeSignal('unusual_silence', { lastRelevantEventAt: '2026-05-01' }),
    ]
    const out = forSurface(signals, { surface: 'dashboard' })
    expect(out[0]!.kind).toBe('unusual_silence')
  })

  it('forSurface plafonne par famille', () => {
    const signals = [
      makeSignal('unusual_silence', { subjectId: 'a' }),
      makeSignal('unusual_silence', { subjectId: 'b' }),
      makeSignal('fresh_field_memory', { subjectId: 'c' }),
    ]
    const out = forSurface(signals, { surface: 'dashboard', perFamilyCap: 2 })
    // les 3 sont famille 'memoire' → cap 2
    expect(out.length).toBe(2)
  })

  it('forSurface filtre par scope site', () => {
    const signals = [
      makeSignal('unusual_silence', { subjectId: 'a' }),
      makeSignal('unusual_silence', { subjectId: 'b' }),
    ]
    const out = forSurface(signals, { surface: 'site', scope: { siteId: 'b' } })
    expect(out).toHaveLength(1)
    expect(out[0]!.subjectId).toBe('b')
  })
})
