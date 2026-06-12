import { insertActivityLog } from '@/lib/db/activity-logs'

/**
 * Helper sémantique pour logger un événement sensible.
 * À appeler depuis les Server Actions, après que l'opération métier
 * a réussi. Si le log échoue, on ne casse pas l'opération métier
 * (best-effort), mais on émet un warning.
 *
 * Liste des événements valides :
 * - tender.analysis_relaunched
 * - mission.status_changed
 * - mission.closed
 * - <entity>.soft_deleted
 * - user.role_changed
 * - user.password_reset_forced
 * - report.validated
 */
export type AuditEntityType =
  | 'tender' | 'mission' | 'user' | 'knowledge_item'
  | 'report' | 'client' | 'site' | 'document'
  // Vincent 2026-05-21 : feedback in-app (cf. /admin/feedback).
  | 'feedback'
  | 'organization'

export type AuditAction =
  | 'analysis_relaunched'
  | 'status_changed'
  | 'closed'
  | 'soft_deleted'
  | 'role_changed'
  | 'password_reset_forced'
  | 'validated'
  | 'created'
  | 'updated'
  | 'evidence_inserted'
  | 'opened'
  | 'downloaded'
  | 'linked'
  // Vincent 2026-05-22 — consultation de pages sensibles (Intervenants, Continuité).
  | 'consulted'

export interface AuditEvent {
  userId: string | null
  entityType: AuditEntityType
  entityId: string | null
  action: AuditAction
  metadata?: Record<string, unknown>
}

// Compteur d'échecs d'audit (par instance) — le garde-fou « audit obligatoire »
// était théorique tant que l'échec restait un console.warn invisible (board
// 2026-05-26). On le rend OBSERVABLE : console.error + compteur exposé dans
// /admin/monitoring. NB : en mémoire process (pas de persistance cross-instance)
// — suffisant comme signal en pilote ; un échec ici signale une dérive DB/RLS.
let auditFailureCount = 0
let lastAuditFailure: { at: string; action: string; message: string } | null = null

export function getAuditFailureStats(): {
  failures: number
  last: { at: string; action: string; message: string } | null
} {
  return { failures: auditFailureCount, last: lastAuditFailure }
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await insertActivityLog({
      userId:     event.userId,
      entityType: event.entityType,
      entityId:   event.entityId,
      action:     event.action,
      metadata:   event.metadata,
    })
  } catch (e) {
    // Ne casse pas le flow métier, mais l'échec n'est PLUS silencieux :
    // console.error (visible en logs prod) + compteur surfacé dans monitoring.
    auditFailureCount += 1
    lastAuditFailure = {
      at: new Date().toISOString(),
      action: `${event.entityType}.${event.action}`,
      message: e instanceof Error ? e.message : String(e),
    }
    console.error('[audit] ÉCHEC insertion activity log (garde-fou audit):', e)
  }
}
