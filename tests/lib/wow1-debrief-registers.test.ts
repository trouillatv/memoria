// WOW-1 — CONTRAT de la reconnexion Debrief : projection en registres depuis la catégorie P2-2 +
// displayState P0-2, et identité ACK par ÉPISODE pour le silence documentaire.
// Debrief = PROJECTION : aucune règle d'état recalculée ; seule la composition est testée ici.

import { describe, it, expect } from 'vitest'
import { buildDebriefSignalKey, registerItems, type DebriefSubjectTruth } from '@/lib/knowledge/live-debrief'
import type { CanonicalAttentionItem, AttentionCategory, CanonicalSignal } from '@/lib/knowledge/canonical-attention'

const item = (
  csId: string,
  category: AttentionCategory,
  signals: CanonicalSignal[],
  reasons: string[] = ['r'],
): CanonicalAttentionItem => ({
  canonicalSubjectId: csId,
  title: `Sujet ${csId}`,
  category,
  urgency: 'medium',
  score: 40,
  signals,
  reasons,
  href: `/x/${csId}`,
})

const truth = (displayState: string, lastSeenAt: string | null, pvSinceLastMention: number): DebriefSubjectTruth =>
  ({ displayState, lastSeenAt, pvSinceLastMention })

describe('buildDebriefSignalKey — ancre d\'épisode', () => {
  it('sans ancre : csId:signals (inchangé, rétro-compatible)', () => {
    expect(buildDebriefSignalKey({ canonicalSubjectId: 'cs1', signals: ['stagnant'] })).toBe('cs1:stagnant')
  })
  it('avec ancre business : csId:signals:ancre', () => {
    expect(buildDebriefSignalKey({ canonicalSubjectId: 'cs1', signals: ['stagnant'] }, '2025-12-03')).toBe('cs1:stagnant:2025-12-03')
  })
  it('ordre des signaux indifférent, ancre préservée', () => {
    const a = buildDebriefSignalKey({ canonicalSubjectId: 'cs1', signals: ['stagnant', 'open_with_objects'] }, 'D')
    const b = buildDebriefSignalKey({ canonicalSubjectId: 'cs1', signals: ['open_with_objects', 'stagnant'] }, 'D')
    expect(a).toBe(b)
  })
})

describe('registerItems — mapping registre + reopened', () => {
  it('category → register 1:1 ; reopened = displayState reopened (P0-2), jamais recalculé', () => {
    const items = [
      item('a', 'act_now', ['pv_aggrave']),
      item('b', 'watch', ['open_with_objects']),
      item('c', 'dormant', ['stagnant']),
      item('d', 'documentary_silence', ['open_with_objects']),
    ]
    const truthByCs = new Map<string, DebriefSubjectTruth>([
      ['a', truth('open', '2026-07-22', 0)],
      ['b', truth('open', '2026-07-22', 0)],
      ['c', truth('reopened', '2026-07-22', 0)], // dormant + reopened
      ['d', truth('open', '2025-12-03', 2)],
    ])
    const out = registerItems(items, truthByCs, new Set())
    expect(out.map((x) => [x.canonicalSubjectId, x.register])).toEqual([
      ['a', 'act_now'], ['b', 'watch'], ['c', 'dormant'], ['d', 'documentary_silence'],
    ])
    expect(out.find((x) => x.canonicalSubjectId === 'c')!.reopened).toBe(true)
    expect(out.find((x) => x.canonicalSubjectId === 'a')!.reopened).toBe(false)
  })

  it('signaux purement opérationnels (action_overdue/deadline_near seuls) exclus (déjà portés par un objet)', () => {
    const out = registerItems([item('op', 'act_now', ['action_overdue'])], new Map(), new Set())
    expect(out).toHaveLength(0)
  })
})

describe('registerItems — 7 invariants ACK', () => {
  const silenceD1 = item('s', 'documentary_silence', ['open_with_objects'])
  const keySilenceD1 = 'x' // placeholder, recomputed below

  it('1. dormant → ACK → dormant inchangé → reste acquitté (disparaît)', () => {
    const it0 = item('c', 'dormant', ['stagnant'])
    const key = buildDebriefSignalKey(it0) // pas d'ancre pour dormant
    const out = registerItems([it0], new Map([['c', truth('open', '2026-01-01', 0)]]), new Set([key]))
    expect(out).toHaveLength(0)
  })

  it('2. dormant → ACK → pv_aggrave → ré-émerge (nouvel ensemble de signaux ET nouvelle catégorie)', () => {
    const acked = buildDebriefSignalKey(item('c', 'dormant', ['stagnant']))
    const worsened = item('c', 'act_now', ['stagnant', 'pv_aggrave'])
    const out = registerItems([worsened], new Map([['c', truth('open', '2026-01-01', 0)]]), new Set([acked]))
    expect(out).toHaveLength(1)
    expect(out[0].register).toBe('act_now')
  })

  it('3. silence A → ACK → silence prolongé (pv 2→3→4) → reste acquitté (même ancre lastSeenAt)', () => {
    const anchor = '2025-12-03'
    const acked = buildDebriefSignalKey(silenceD1, anchor)
    for (const pv of [2, 3, 4]) {
      const out = registerItems([silenceD1], new Map([['s', truth('open', anchor, pv)]]), new Set([acked]))
      expect(out, `pvSince=${pv} doit rester acquitté`).toHaveLength(0)
    }
  })

  it('4. silence A → ACK → réapparition (redevient dormant présent) → n\'est plus un silence acquitté', () => {
    const ackedSilence = buildDebriefSignalKey(silenceD1, '2025-12-03')
    // réapparu : displayState open, présent (pvSince 0), catégorie dormant (plus silence)
    const reappeared = item('s', 'dormant', ['stagnant'])
    const out = registerItems([reappeared], new Map([['s', truth('open', '2026-02-19', 0)]]), new Set([ackedSilence]))
    expect(out).toHaveLength(1)
    expect(out[0].register).toBe('dormant')
  })

  it('5. réapparition → nouveau silence B (nouveau lastSeenAt) → ré-émerge unseen', () => {
    const ackedSilenceA = buildDebriefSignalKey(silenceD1, '2025-12-03')
    // silence B : dernière mention plus récente (réapparition PV puis re-silence)
    const out = registerItems([silenceD1], new Map([['s', truth('open', '2026-02-19', 2)]]), new Set([ackedSilenceA]))
    expect(out).toHaveLength(1)
    expect(out[0].register).toBe('documentary_silence')
    expect(out[0].signalKey).toBe('s:open_with_objects:2026-02-19')
    expect(out[0].ack).toBe('unseen')
  })

  it('6. changement de présentation (reasons/title) sans changement de signaux → reste acquitté', () => {
    const acked = buildDebriefSignalKey(item('c', 'dormant', ['stagnant']))
    const cosmetic = item('c', 'dormant', ['stagnant'], ['texte reformulé, aucune preuve nouvelle'])
    const out = registerItems([cosmetic], new Map([['c', truth('open', '2026-01-01', 0)]]), new Set([acked]))
    expect(out).toHaveLength(0)
  })

  it('7. import rétroactif : ancre = chronologie business (lastSeenAt), jamais une date technique', () => {
    // Deux imports rétroactifs différents ne changent la clé QUE s'ils changent lastSeenAt business.
    const k1 = buildDebriefSignalKey(silenceD1, '2025-12-03')
    const k2 = buildDebriefSignalKey(silenceD1, '2025-12-03') // même business date, import à un autre moment
    expect(k1).toBe(k2)
    // Une mention business postérieure (nouvelle occurrence datée) change l'épisode :
    const k3 = buildDebriefSignalKey(silenceD1, '2026-07-22')
    expect(k3).not.toBe(k1)
  })
})
