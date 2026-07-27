import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'

export type SituationKind =
  | 'expired_promise'
  | 'unconfirmed_promise'
  | 'upcoming_promise'
  | 'stale_action'
  | 'overdue_action'
  | 'upcoming_action'
  | 'open_reserve'
  | 'planning_conflict'
  | 'pending_debrief'

export type SituationSeverity = 'info' | 'warning' | 'critical'

export type SituationSource = {
  type: string
  id: string
  label: string
  href: string
}

/** Gestes possibles sur une situation. `open_source` est un lien ; les autres
 *  sont des MUTATIONS déclenchées avec le `subject` de la situation (T3/T4). */
export type SituationResolutionKind =
  | 'fulfill_promise'
  | 'cancel_promise'
  | 'replace_promise'
  | 'create_follow_up_action'

export type SituationCapability =
  | { kind: 'open_source'; label: string; href: string }
  | { kind: SituationResolutionKind; label: string }

export type SituationTiming = {
  occurredAt: string | null
  dueAt: string | null
  detectedAt: string
  ageDays: number | null
  label: string | null
}

export type Situation = {
  id: string
  signalId: string
  kind: SituationKind
  severity: SituationSeverity
  title: string
  explanation: string | null
  site: {
    id: string
    name: string
    organizationId: string
    organizationName: string | null
  }
  timing: SituationTiming
  source: SituationSource | null
  /**
   * Objet persistant résoluble (T2), propagé depuis le signal. DISTINCT de
   * `source` (la preuve consultable) : `subject` dit à une future mutation OÙ
   * écrire. `null` pour les situations sans objet mutable (legacy, agrégats).
   * Jamais affiché.
   */
  subject: PromiseSubjectRef | null
  capabilities: SituationCapability[]
}
