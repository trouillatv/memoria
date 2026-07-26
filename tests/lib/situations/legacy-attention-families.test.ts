// Migration des familles d'alertes legacy vers Situation → AttentionCard.
// « Action ancienne » (stale_action) est couverte ailleurs ; ici : « action en
// retard » (overdue_action) et « réserve ouverte » (open_reserve), + le prédicat
// isMigratedLegacyAttention (source unique de vérité du dashboard).

import { describe, expect, it } from 'vitest'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import { presentSituation, isMigratedLegacyAttention } from '@/lib/situations/presenter'
import { projectSituationForAttention } from '@/lib/situations/attention/project'

function signal(trigger: MemorySignal['trigger'], over: Partial<MemorySignal> = {}): MemorySignal {
  const detectedAt = '2026-07-25T08:00:00.000Z'
  const fact = (key: string, value: string) => ({
    type: 'attention_item', key, value, confidence: null,
    sourceIds: ['src-1'], detectedAt, occurredAt: null, dueAt: null, validUntil: null,
  })
  return {
    id: `attention:${trigger.type}:${trigger.reason}:site-1`,
    organizationId: 'org-1', siteId: 'site-1',
    category: 'priority', trigger, severity: 'warning', importance: 'high', urgency: 'today',
    state: 'active', actionability: 'direct', origin: 'rules',
    facts: [fact('what', '2 actions en retard'), fact('why', 'la plus en retard : « X » (+5 j)'), fact('where', 'Chantier Pointière')],
    rules: [{ id: trigger.type, version: '1' }],
    sources: [{ type: 'action', id: 'a-1', href: '/sites/site-1/actions', label: 'Reboucher' }],
    actions: [], confidence: null, dedupeKey: 'k', detectedAt,
    acknowledgedAt: null, resolvedAt: null, resolvedBy: null,
    ...over,
  }
}

describe('action en retard → overdue_action', () => {
  const s = signal({ type: 'old_action', reason: 'deadline_overdue' })

  it('présente une Situation overdue_action, faits inchangés', () => {
    const situation = presentSituation(s)
    expect(situation).toMatchObject({
      kind: 'overdue_action', title: '2 actions en retard',
      site: { name: 'Chantier Pointière' },
      timing: { label: 'la plus en retard : « X » (+5 j)' },
      source: { href: '/sites/site-1/actions' },
    })
  })

  it('projette une card (icône calendar)', () => {
    const card = projectSituationForAttention(presentSituation(s))
    expect(card).toMatchObject({ icon: 'calendar', title: '2 actions en retard' })
  })

  it('est reconnue comme famille migrée', () => {
    expect(isMigratedLegacyAttention(s)).toBe(true)
  })
})

describe('réserve ouverte → open_reserve', () => {
  const s = signal({ type: 'open_reserve', reason: 'object_aging' }, {
    category: 'fragility', actionability: 'investigate',
    facts: [
      { type: 'a', key: 'what', value: '3 réserves ouvertes', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'why', value: 'la plus ancienne depuis 42 j', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'where', value: 'Lycée LPCH', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ],
    sources: [{ type: 'reserve', id: 'site-1', href: '/sites/site-1/reserves', label: 'Réserve ouverte' }],
    severity: 'critical',
  })

  it('présente une Situation open_reserve → card ambre/rouge selon severity', () => {
    const situation = presentSituation(s)
    expect(situation).toMatchObject({ kind: 'open_reserve', title: '3 réserves ouvertes', severity: 'critical' })
    const card = projectSituationForAttention(situation)
    expect(card).toMatchObject({ icon: 'warning', tone: 'red', title: '3 réserves ouvertes' })
  })

  it('est reconnue comme famille migrée', () => {
    expect(isMigratedLegacyAttention(s)).toBe(true)
  })
})

describe('conflit de planning → planning_conflict', () => {
  const s = signal({ type: 'planning_conflict', reason: 'planning_conflict' }, {
    category: 'fragility',
    facts: [
      { type: 'a', key: 'what', value: '3 prestations prévues un jour de fermeture', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'why', value: 'le lundi 27 juillet — chantier fermé', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'where', value: 'Chantier Pointière', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ],
    sources: [{ type: 'planning', id: 'site-1', href: '/semaine', label: 'Conflit de planning' }],
    severity: 'critical',
  })

  it('présente une Situation planning_conflict, faits inchangés', () => {
    const situation = presentSituation(s)
    expect(situation).toMatchObject({
      kind: 'planning_conflict',
      title: '3 prestations prévues un jour de fermeture',
      site: { name: 'Chantier Pointière' },
      timing: { label: 'le lundi 27 juillet — chantier fermé' },
      source: { href: '/semaine' },
    })
  })

  it('projette une card rouge (icône calendar)', () => {
    const card = projectSituationForAttention(presentSituation(s))
    expect(card).toMatchObject({ icon: 'calendar', tone: 'red', title: '3 prestations prévues un jour de fermeture' })
  })

  it('est reconnue comme famille migrée', () => {
    expect(isMigratedLegacyAttention(s)).toBe(true)
  })
})

describe('débrief en attente → pending_debrief', () => {
  const s = signal({ type: 'missing_attachment', reason: 'attachment_missing' }, {
    category: 'priority',
    facts: [
      { type: 'a', key: 'what', value: '2 visites à débriefer', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'why', value: 'la plus ancienne date d’il y a 3 j — 5 éléments en attente', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
      { type: 'a', key: 'where', value: 'Chantier Pointière', confidence: null, sourceIds: ['s'], detectedAt: '2026-07-25T08:00:00.000Z', occurredAt: null, dueAt: null, validUntil: null },
    ],
    sources: [{ type: 'visit', id: 'report-1', href: '/sites/site-1/visites/report-1', label: 'Visite à débriefer' }],
  })

  it('présente une Situation pending_debrief, faits inchangés', () => {
    const situation = presentSituation(s)
    expect(situation).toMatchObject({
      kind: 'pending_debrief',
      title: '2 visites à débriefer',
      site: { name: 'Chantier Pointière' },
      timing: { label: 'la plus ancienne date d’il y a 3 j — 5 éléments en attente' },
      source: { href: '/sites/site-1/visites/report-1' },
    })
  })

  it('projette une card ambre (icône document)', () => {
    const card = projectSituationForAttention(presentSituation(s))
    expect(card).toMatchObject({ icon: 'document', tone: 'amber', title: '2 visites à débriefer' })
  })

  it('est reconnue comme famille migrée', () => {
    expect(isMigratedLegacyAttention(s)).toBe(true)
  })
})

describe('familles NON migrées', () => {
  it('un trigger inconnu n\'est ni migré ni présenté (reste legacy)', () => {
    const s = signal({ type: 'unknown_family', reason: 'not_annotated' } as unknown as MemorySignal['trigger'])
    expect(isMigratedLegacyAttention(s)).toBe(false)
    expect(presentSituation(s)).toBeNull()
  })
})
