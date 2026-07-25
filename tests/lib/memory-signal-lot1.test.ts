import { describe, expect, it } from 'vitest'
import { attentionItemToMemorySignal, nowItemToMemorySignal } from '@/lib/memory/signals/lot1-adapters'
import type { AttentionItem } from '@/lib/db/attention'
import type { NowDashboardItem } from '@/lib/db/now-dashboard'

const attention: AttentionItem = {
  siteId: 'site-1',
  tier: 'red',
  what: '1 conflit de planning',
  where: 'Ducos',
  why: 'prestation prévue un jour de fermeture',
  href: '/semaine',
  organizationId: 'org-1',
  signal: {
    category: 'fragility',
    trigger: { type: 'planning_conflict', reason: 'planning_conflict' },
    actionability: 'direct',
    origin: 'rules',
    dedupeKey: 'planning-conflict:site-1:2026-07-25',
    sources: [{ type: 'planning', id: 'site-1', href: '/semaine', label: 'Conflit de planning' }],
  },
}

describe('Lot 1 — adaptateurs MemorySignal', () => {
  it('normalise une alerte annotée sans analyser son texte', () => {
    const signal = attentionItemToMemorySignal(attention, '2026-07-25T08:00:00.000Z')

    expect(signal).toMatchObject({
      id: 'attention:planning-conflict:site-1:2026-07-25',
      siteId: 'site-1',
      category: 'fragility',
      severity: 'critical',
      actionability: 'direct',
      origin: 'rules',
      confidence: null,
      state: 'active',
    })
    expect(signal?.facts[0]).toMatchObject({
      confidence: null,
      occurredAt: null,
      dueAt: null,
      validUntil: null,
    })
  })

  it('refuse de classer une ancienne ligne non annotée par son libellé', () => {
    const { signal: _ignored, ...unannotated } = attention
    expect(attentionItemToMemorySignal(unannotated)).toBeNull()
  })

  it('normalise une priorité du cockpit comme geste direct', () => {
    const item: NowDashboardItem = {
      id: 'action:1',
      sourceType: 'action',
      title: 'Contacter PAVE',
      siteId: 'site-1',
      siteName: 'Ducos',
      organization: { id: 'org-1', name: 'AGP', slug: 'agp', logoPath: null, logoUrl: null, brandColor: null },
      href: '/sites/site-1/actions',
      dueDate: '2026-07-25',
      startsAt: null,
      priority: 'today',
      canComplete: true,
      actionId: 'action-1',
    }

    const signal = nowItemToMemorySignal(item, '2026-07-25T08:00:00.000Z')
    expect(signal).toMatchObject({
      category: 'priority',
      actionability: 'direct',
      actions: [{ kind: 'complete', label: 'Traiter' }],
      confidence: null,
    })
    expect(signal.facts[0]).toMatchObject({
      dueAt: '2026-07-25',
      occurredAt: null,
      validUntil: null,
      confidence: null,
    })
  })
})
