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
