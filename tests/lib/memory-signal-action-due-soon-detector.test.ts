// Anticipation des actions (action_due_soon) — uniquement l'échéance de DEMAIN
// (civil Nouméa) : le dépassé appartient au digest legacy, le « dû aujourd'hui »
// à « À faire maintenant ». Jamais de doublon.

import { describe, expect, it } from 'vitest'
import { detectActionDueSoonSignals } from '@/lib/memory/signals/action-due-soon-detector'
import { presentSituation } from '@/lib/situations/presenter'
import { projectSituationForAttention } from '@/lib/situations/attention/project'
import type { SiteActionRow } from '@/lib/db/site-actions'

// 2026-07-28T08:00Z = 2026-07-28 19:00 à Nouméa → demain local = 2026-07-29.
const NOW = '2026-07-28T08:00:00.000Z'

const row = (over: Partial<SiteActionRow> = {}): SiteActionRow => ({
  id: 'action-1', title: 'Relancer le menuisier', body: null, corps_etat: null, assigned_to: null,
  status: 'open', kind: 'deadline', created_at: '2026-07-20T00:00:00.000Z', due_date: '2026-07-29',
  report_id: null, converted_to_type: null, converted_to_id: null,
  site_id: 'site-1', organizationId: 'org-1', site_name: 'Lycée PETRO ATTITI',
  contract_id: null, contract_name: null, subject_id: null,
  last_progress_at: null, snooze_reason: null, snoozed_at: null, subject_thread_id: null, ...over,
})

describe('ActionDueSoonDetector', () => {
  it('action ouverte due DEMAIN → signal deadline_soon avec dueAt', () => {
    const [signal] = detectActionDueSoonSignals([row()], NOW)
    expect(signal).toMatchObject({
      trigger: { type: 'old_action', reason: 'deadline_soon' },
      severity: 'warning',
      dedupeKey: 'action-due-soon:site-1:action-1',
      subject: null,
    })
    expect(signal.facts.find((f) => f.key === 'what')).toMatchObject({ value: 'Relancer le menuisier', dueAt: '2026-07-29' })
  })

  it("due AUJOURD'HUI → aucun signal (déjà dans « À faire maintenant »)", () => {
    expect(detectActionDueSoonSignals([row({ due_date: '2026-07-28' })], NOW)).toHaveLength(0)
  })

  it('dépassée ou lointaine → aucun signal', () => {
    expect(detectActionDueSoonSignals([row({ due_date: '2026-07-27' })], NOW)).toHaveLength(0)
    expect(detectActionDueSoonSignals([row({ due_date: '2026-07-30' })], NOW)).toHaveLength(0)
    expect(detectActionDueSoonSignals([row({ due_date: null })], NOW)).toHaveLength(0)
  })

  it('statut non ouvert → aucun signal', () => {
    expect(detectActionDueSoonSignals([row({ status: 'done' as SiteActionRow['status'] })], NOW)).toHaveLength(0)
  })

  it('traverse presenter + projection : carte À ANTICIPER (upcoming_action, ambre, Échéance demain)', () => {
    const [signal] = detectActionDueSoonSignals([row()], NOW)
    const situation = presentSituation(signal, NOW)
    expect(situation).toMatchObject({ kind: 'upcoming_action', title: 'Relancer le menuisier' })
    expect(situation?.timing.label).toBe('Échéance demain')

    const card = projectSituationForAttention(situation, new Date(NOW))
    expect(card).toMatchObject({ kind: 'upcoming_action', tone: 'amber', siteLabel: 'Lycée PETRO ATTITI' })
    // Anticipation < action en retard (doctrine : dépassé d'abord).
    expect(card!.priority).toBeLessThan(65)
  })

  it('le scoring partage la MÊME notion de « demain » que le détecteur (civil Nouméa, pas UTC)', () => {
    // 2026-07-28T14:00Z = 2026-07-29 01:00 à Nouméa : la date UTC (28) et la
    // date Nouméa (29) divergent — le cas qui piégeait l\'ancien calcul UTC.
    const MIDNIGHT_WINDOW = '2026-07-28T14:00:00.000Z'
    const [signal] = detectActionDueSoonSignals([row({ due_date: '2026-07-30' })], MIDNIGHT_WINDOW)
    expect(signal).toBeDefined() // demain Nouméa = 30
    const situation = presentSituation(signal, MIDNIGHT_WINDOW)
    const card = projectSituationForAttention(situation, new Date(MIDNIGHT_WINDOW))
    // impact upcoming_action 25 + urgence « demain » 15 (et non « thisWeek » 10 en UTC).
    expect(card!.priority).toBe(40)
  })
})
