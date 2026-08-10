import { describe, expect, it } from 'vitest'
import { rankBriefingAttention } from '@/lib/knowledge/visit-briefing'
import type { SiteAttentionItem } from '@/lib/knowledge/site-attention-items'

// ── Helpers ───────────────────────────────────────────────────────────────────

function item(
  signal: string,
  urgency: SiteAttentionItem['urgency'],
  title = signal,
): SiteAttentionItem {
  return {
    signal: signal as SiteAttentionItem['signal'],
    title,
    reason: 'test',
    urgency,
    href: '/test',
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rankBriefingAttention', () => {
  it('retourne [] sur liste vide', () => {
    expect(rankBriefingAttention([])).toEqual([])
  })

  it('écarte les items low systématiquement', () => {
    const items = [
      item('subject_changed', 'low'),
      item('proposal_pending', 'low'),
    ]
    expect(rankBriefingAttention(items)).toHaveLength(0)
  })

  it('les criticals passent toujours en premier', () => {
    const items = [
      item('action_overdue', 'medium'),
      item('blocage_active', 'critical'),
      item('reserve_open', 'high'),
    ]
    const result = rankBriefingAttention(items)
    expect(result[0].urgency).toBe('critical')
    expect(result[1].urgency).toBe('high')
    expect(result[2].urgency).toBe('medium')
  })

  it('respecte le cap à 6 items par défaut', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item('action_overdue', 'high', `action-${i}`),
    )
    expect(rankBriefingAttention(items)).toHaveLength(6)
  })

  it('respecte un cap personnalisé', () => {
    const items = [
      item('blocage_active', 'critical'),
      item('action_overdue', 'high'),
      item('reserve_open', 'medium'),
    ]
    expect(rankBriefingAttention(items, 2)).toHaveLength(2)
  })

  it('diversifie par signal à même niveau d\'urgence — high', () => {
    const items = [
      item('action_overdue', 'high', 'action-1'),
      item('action_overdue', 'high', 'action-2'),
      item('action_overdue', 'high', 'action-3'),
      item('reserve_open',   'high', 'reserve-1'),
      item('subject_stagnant', 'high', 'sujet-1'),
    ]
    const result = rankBriefingAttention(items, 4)
    // Les 3 premiers doivent être de signaux différents (round 1)
    const signals = result.slice(0, 3).map(i => i.signal)
    const uniqueSignals = new Set(signals)
    expect(uniqueSignals.size).toBe(3)
  })

  it('diversifie par signal à même niveau d\'urgence — medium', () => {
    const items = [
      item('pv_stagnant', 'medium', 'm1'),
      item('pv_stagnant', 'medium', 'm2'),
      item('pv_stagnant', 'medium', 'm3'),
      item('actor_congestion', 'medium', 'm4'),
    ]
    const result = rankBriefingAttention(items, 4)
    // actor_congestion doit apparaître avant le 3e pv_stagnant
    const acIdx = result.findIndex(i => i.signal === 'actor_congestion')
    const pvCount = result.filter(i => i.signal === 'pv_stagnant').length
    expect(acIdx).toBeLessThan(pvCount) // actor_congestion avant les pv_stagnant en surplus
  })

  it('mélange urgences sans low — critical d\'abord, puis high, puis medium', () => {
    const items = [
      item('action_overdue', 'medium'),
      item('subject_changed', 'low'),
      item('blocage_active', 'critical'),
      item('reserve_open', 'high'),
    ]
    const result = rankBriefingAttention(items)
    expect(result).toHaveLength(3) // low exclu
    expect(result.map(i => i.urgency)).toEqual(['critical', 'high', 'medium'])
  })

  it('fonctionne quand il n\'y a que des criticals', () => {
    const items = [
      item('blocage_active', 'critical', 'b1'),
      item('blocage_active', 'critical', 'b2'),
    ]
    const result = rankBriefingAttention(items)
    expect(result).toHaveLength(2)
    expect(result.every(i => i.urgency === 'critical')).toBe(true)
  })
})
