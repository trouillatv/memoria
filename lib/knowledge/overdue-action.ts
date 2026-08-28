// due_date_status distingue une date CONFIRMÉE par un humain (explicit) d'une
// date DÉDUITE par l'IA (estimated / null). Règle UNIQUE partagée par les
// moteurs d'attention (site-attention-items.ts, canonical-attention.ts) pour
// ne jamais affirmer « en retard » sur une date non confirmée — l'absence de
// confirmation n'est pas une preuve de retard (retour Guillaume 2026-08-14,
// LOT4). Fonction pure : un seul endroit où la règle peut diverger entre
// moteurs, testée une fois pour tous.

export type DueDateStatus = 'explicit' | 'estimated' | null

export interface OverdueActionInfo {
  confirmed: boolean
  overdueDays: number
  reason: string
}

export function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86_400_000)
}

export function describeOverdueAction(
  title: string,
  dueDate: string,
  dueDateStatus: DueDateStatus,
  today: string,
): OverdueActionInfo {
  const overdueDays = daysBetween(dueDate, today)
  const confirmed = dueDateStatus === 'explicit'
  const reason = confirmed
    ? `Action « ${title} » en retard de ${overdueDays} j`
    : `Prévu le ${dueDate} · réalisation non confirmée`
  return { confirmed, overdueDays, reason }
}

// ── Urgence d'une action — SOURCE UNIQUE partagée Aperçu + écran Actions ────────
// Une seule définition de « en retard » pour que les surfaces ne divergent jamais
// (P0.5-Vérité). Une échéance dépassée mais NON confirmée (due_date_status !=
// 'explicit') n'est jamais « en retard » : elle est 'late_unconfirmed'. Un 'planned'
// a une prise en charge explicite → jamais compté « en retard ».

export type ActionUrgency = 'late' | 'late_unconfirmed' | 'today' | 'week' | 'later' | 'undated'

/** Urgence métier selon l'échéance ET la confirmation de la date (pur, testé). */
export function classifyActionUrgency(dueDate: string | null, dueDateStatus: DueDateStatus, todayIso: string): ActionUrgency {
  if (!dueDate) return 'undated'
  const due = dueDate.slice(0, 10)
  if (due < todayIso) return dueDateStatus === 'explicit' ? 'late' : 'late_unconfirmed'
  if (due === todayIso) return 'today'
  const days = Math.floor((Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`)) / 86_400_000)
  return days <= 7 ? 'week' : 'later'
}

/** « En retard » au sens CANONIQUE : action ouverte + échéance explicite dépassée.
 *  (planned exclu ; date non confirmée exclue.) Utilisé pour les COMPTEURS. */
export function isActionOverdue(status: string | null, dueDate: string | null, dueDateStatus: DueDateStatus, todayIso: string): boolean {
  return status === 'open' && classifyActionUrgency(dueDate, dueDateStatus, todayIso) === 'late'
}
