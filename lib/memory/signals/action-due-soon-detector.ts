// Anticipation des ACTIONS (parallèle de promise_expiring_soon) : une action
// ouverte dont l'échéance tombe DEMAIN (date civile Nouméa) entre dans le flux
// Attention comme « À anticiper ».
//
// Périmètre volontairement borné à DEMAIN :
// - dépassée → déjà couverte par le digest legacy (deadline_overdue) ;
// - due aujourd'hui → déjà dans « À faire maintenant » (now-dashboard) ;
// signaler ces cas ici créerait des doublons.

import type { MemorySignal } from './operational-contract'
import type { SiteActionRow } from '@/lib/db/site-actions'
import { localDateOf, addDaysLocal } from '@/lib/time/local-date'

/** Actions ouvertes avec échéance demain (civil Nouméa) → signaux d'anticipation. */
export function detectActionDueSoonSignals(
  actions: SiteActionRow[],
  now = new Date().toISOString(),
): MemorySignal[] {
  const nowTimestamp = Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) return []
  const tomorrowLocal = addDaysLocal(localDateOf(new Date(nowTimestamp)), 1)

  return actions.flatMap((action) => {
    if (action.status !== 'open' && action.status !== 'planned') return []
    // due_date est déjà une date civile (yyyy-mm-dd) — comparaison directe.
    if (action.due_date !== tomorrowLocal) return []

    const href = `/sites/${action.site_id}/actions`
    return [{
      id: `action-due-soon:${action.site_id}:${action.id}`,
      organizationId: action.organizationId,
      siteId: action.site_id,
      category: 'priority',
      trigger: { type: 'old_action', reason: 'deadline_soon' },
      severity: 'warning',
      importance: 'normal',
      urgency: 'week',
      state: 'active',
      actionability: 'investigate',
      origin: 'rules',
      facts: [
        {
          type: 'action', key: 'what', value: action.title, confidence: null,
          sourceIds: [], detectedAt: now, occurredAt: action.created_at, dueAt: action.due_date, validUntil: null,
        },
        {
          type: 'site', key: 'where', value: action.site_name, confidence: null,
          sourceIds: [], detectedAt: now, occurredAt: null, dueAt: null, validUntil: null,
        },
      ],
      rules: [{ id: 'action_due_soon', version: '1' }],
      sources: [{ type: 'site', id: action.site_id, href, label: action.site_name }],
      subject: null,
      actions: [{ kind: 'investigate', label: "Voir l'action", href }],
      confidence: null,
      dedupeKey: `action-due-soon:${action.site_id}:${action.id}`,
      detectedAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    } satisfies MemorySignal]
  })
}
