import { describe, it, expect } from 'vitest'
import type { MemorySignal, SignalKind } from '@/lib/memory/signals/types'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'
import { renderSignal } from '@/lib/memory/signals/render'
import { forSurface } from '@/lib/memory/signals/surface'
import {
  buildMemoryAwaitingSignals,
  type AwaitingBriefInput,
} from '@/lib/memory/signals/detectors/memory-awaiting.logic'
import {
  buildHandoverAcknowledgedSignals,
  type AckBriefInput,
} from '@/lib/memory/signals/detectors/handover-acknowledged.logic'
import {
  buildFreshFieldMemorySignals,
  type FieldNoteInput,
} from '@/lib/memory/signals/detectors/fresh-field-memory.logic'
import {
  buildUnusualSilenceSignals,
  type SiteInput,
  type TraceInput,
} from '@/lib/memory/signals/detectors/unusual-silence.logic'

const NO_IMPERATIVE = /\b(doit|doivent|devez|lire|relire|en retard|urgent|veuillez)\b|!/i

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

describe('détecteur memory_awaiting (cœur pur)', () => {
  const FIXTURE: AwaitingBriefInput[] = [
    { id: 'b1', sharedAt: '2026-05-10T00:00:00.000Z', consulted: false, sites: [{ site_id: 's1', site_name: 'CHT Magenta' }] },
    { id: 'b2', sharedAt: '2026-05-18T00:00:00.000Z', consulted: true, sites: [{ site_id: 's1', site_name: 'CHT Magenta' }, { site_id: 's2', site_name: 'Dumbéa Mall' }] },
    { id: 'b3', sharedAt: '2026-05-22T00:00:00.000Z', consulted: false, sites: [{ site_id: 's3', site_name: 'Aile pédiatrie' }] }, // < seuil → exclu
  ]
  const NOW = new Date('2026-05-22T12:00:00.000Z').getTime()

  it('déterministe : mêmes données + même now ⇒ mêmes signaux', () => {
    const a = buildMemoryAwaitingSignals(FIXTURE, NOW)
    const b = buildMemoryAwaitingSignals(FIXTURE, NOW)
    expect(a).toEqual(b)
  })

  it('agrège par lieu et exclut ce qui est sous le seuil', () => {
    const out = buildMemoryAwaitingSignals(FIXTURE, NOW)
    const ids = out.map((s) => s.subjectId)
    expect(ids).toEqual(['s1', 's2']) // s3 exclu (partagé le jour même)
    const s1 = out.find((s) => s.subjectId === 's1')!
    expect(s1.facts.awaitingBriefs).toBe(2)
    expect(s1.evidence.refs).toEqual(['b1', 'b2'])
  })

  it('le signal ne porte JAMAIS sur une personne', () => {
    const out = buildMemoryAwaitingSignals(FIXTURE, NOW)
    expect(out.every((s) => s.subjectType === 'site')).toBe(true)
    // @ts-expect-error — 'person' n'existe pas dans SubjectType (verrou de type)
    expect(out.every((s) => s.subjectType !== 'person')).toBe(true)
  })

  it('aucun wording impératif côté renderer', () => {
    const out = buildMemoryAwaitingSignals(FIXTURE, NOW)
    for (const sig of out) {
      const r = renderSignal(sig)
      expect(NO_IMPERATIVE.test(r.text)).toBe(false)
      expect(NO_IMPERATIVE.test(r.detail ?? '')).toBe(false)
    }
  })
})

describe('détecteur handover_acknowledged (cœur pur)', () => {
  const NOW = new Date('2026-05-22T12:00:00.000Z').getTime()
  const FIXTURE: AckBriefInput[] = [
    { id: 'b1', acknowledgedAt: '2026-05-20T00:00:00.000Z', sites: [{ site_id: 's1', site_name: 'CHT Magenta' }] },
    { id: 'b2', acknowledgedAt: '2026-05-15T00:00:00.000Z', sites: [{ site_id: 's1', site_name: 'CHT Magenta' }] },
    { id: 'b3', acknowledgedAt: '2026-04-01T00:00:00.000Z', sites: [{ site_id: 's2', site_name: 'Dumbéa Mall' }] }, // hors fenêtre 14j
  ]

  it('déterministe sur mêmes données', () => {
    expect(buildHandoverAcknowledgedSignals(FIXTURE, NOW)).toEqual(buildHandoverAcknowledgedSignals(FIXTURE, NOW))
  })

  it('garde la reconnaissance la plus récente par lieu et exclut hors fenêtre', () => {
    const out = buildHandoverAcknowledgedSignals(FIXTURE, NOW)
    expect(out.map((s) => s.subjectId)).toEqual(['s1']) // s2 hors fenêtre
    expect(out[0]!.lastRelevantEventAt).toBe('2026-05-20T00:00:00.000Z')
    expect(out[0]!.evidence.refs).toEqual(['b1', 'b2'])
  })

  it('sujet site only + rendu non impératif', () => {
    const out = buildHandoverAcknowledgedSignals(FIXTURE, NOW)
    expect(out.every((s) => s.subjectType === 'site')).toBe(true)
    for (const sig of out) expect(NO_IMPERATIVE.test(renderSignal(sig).text)).toBe(false)
  })
})

describe('détecteur fresh_field_memory (cœur pur)', () => {
  const NOW = new Date('2026-05-22T12:00:00.000Z').getTime()
  const FIXTURE: FieldNoteInput[] = [
    { id: 'n1', siteId: 's1', siteName: 'CHT Magenta', createdAt: '2026-05-21T08:00:00.000Z' },
    { id: 'n2', siteId: 's1', siteName: 'CHT Magenta', createdAt: '2026-05-19T08:00:00.000Z' },
    { id: 'n3', siteId: 's2', siteName: 'Dumbéa Mall', createdAt: '2026-05-01T08:00:00.000Z' }, // hors fenêtre 7j
  ]

  it('déterministe sur mêmes données', () => {
    expect(buildFreshFieldMemorySignals(FIXTURE, NOW)).toEqual(buildFreshFieldMemorySignals(FIXTURE, NOW))
  })

  it('agrège par lieu sur la fenêtre et exclut hors fenêtre', () => {
    const out = buildFreshFieldMemorySignals(FIXTURE, NOW)
    expect(out.map((s) => s.subjectId)).toEqual(['s1'])
    expect(out[0]!.facts.notesAdded).toBe(2)
    expect(out[0]!.evidence.refs).toEqual(['n1', 'n2'])
  })

  it('sujet site only + rendu non impératif', () => {
    const out = buildFreshFieldMemorySignals(FIXTURE, NOW)
    expect(out.every((s) => s.subjectType === 'site')).toBe(true)
    for (const sig of out) expect(NO_IMPERATIVE.test(renderSignal(sig).text)).toBe(false)
  })
})

describe('détecteur unusual_silence (cœur pur)', () => {
  const NOW = new Date('2026-05-22T12:00:00.000Z').getTime()
  const SITES: SiteInput[] = [
    { id: 's1', name: 'CHT Magenta' },
    { id: 's2', name: 'Dumbéa Mall' },
    { id: 's3', name: 'Site neuf' },
  ]
  const TRACES: TraceInput[] = [
    { siteId: 's1', scheduledFor: '2026-05-01' }, // 21j → silence
    { siteId: 's1', scheduledFor: '2026-04-20' },
    { siteId: 's2', scheduledFor: '2026-05-20' }, // 2j → ok
    // s3 : aucune trace → pas un silence (site neuf)
  ]

  it('déterministe sur mêmes données', () => {
    expect(buildUnusualSilenceSignals(SITES, TRACES, NOW)).toEqual(buildUnusualSilenceSignals(SITES, TRACES, NOW))
  })

  it('flag seulement les sites ayant eu de l’activité puis silencieux > seuil', () => {
    const out = buildUnusualSilenceSignals(SITES, TRACES, NOW)
    expect(out.map((s) => s.subjectId)).toEqual(['s1']) // s2 récent, s3 jamais
    expect(out[0]!.facts.daysSinceLastTrace).toBe(21)
    expect(out[0]!.lastRelevantEventAt).toBe('2026-05-01')
  })

  it('sujet site only', () => {
    const out = buildUnusualSilenceSignals(SITES, TRACES, NOW)
    expect(out.every((s) => s.subjectType === 'site')).toBe(true)
  })
})
