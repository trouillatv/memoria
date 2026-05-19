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

export interface AuditEvent {
  userId: string | null
  entityType: AuditEntityType
  entityId: string | null
  action: AuditAction
  metadata?: Record<string, unknown>
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
    // Log warning mais ne casse pas le flow métier
    console.warn('[audit] failed to insert activity log:', e)
  }
}
