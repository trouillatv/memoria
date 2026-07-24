/** Contrat cible des signaux consommés par les surfaces opérationnelles. */

export type OperationalSignalCategory =
  | 'priority'
  | 'fragility'
  | 'promise'
  | 'question'
  | 'contradiction'
  | 'staleness'
  | 'health'

export type OperationalSignalSeverity = 'info' | 'warning' | 'critical'
export type OperationalSignalState = 'active' | 'acknowledged' | 'resolved' | 'dismissed' | 'expired'
export type OperationalActionability = 'direct' | 'investigate' | 'observe'
export type OperationalSignalOrigin = 'rules' | 'mixed' | 'ai'
export type OperationalSignalTriggerType =
  | 'old_action'
  | 'open_reserve'
  | 'missing_company'
  | 'missing_contact'
  | 'missing_attachment'
  | 'planning_conflict'
  | 'promise'
  | 'question'
  | 'contradiction'
  | 'staleness'
  | 'health'
  | 'imminent_passage'
  | 'overdue_deadline'

export type OperationalSignalReason =
  | 'company_not_linked'
  | 'company_not_created'
  | 'company_archived'
  | 'contact_not_identified'
  | 'attachment_missing'
  | 'planning_conflict'
  | 'promise_expired'
  | 'question_unanswered'
  | 'facts_incompatible'
  | 'object_aging'
  | 'activity_missing'
  | 'deadline_overdue'
  | 'passage_imminent'
  | 'other'

export type OperationalImportance = 'critical' | 'high' | 'normal' | 'low'
export type OperationalUrgency = 'now' | 'today' | 'week' | 'later'

export type SourceRef = {
  type: string
  id: string
  href: string
  label: string
}

export type SuggestedAction = {
  kind: string
  label: string
  href: string | null
}

export type SignalFact = {
  type: string
  key: string
  value: string | number | boolean | null
  confidence: number | null
  sourceIds: string[]
  detectedAt: string
  validUntil: string | null
}

export type SignalRule = {
  id: string
  version: string
}

export type SignalResolution =
  | 'action_completed'
  | 'proof_added'
  | 'explicit_confirmation'
  | 'user_dismissal'
  | 'expiration'
  | 'superseded'

export type SignalPresentation = {
  surface: 'dashboard' | 'visit_preparation' | 'site' | 'notification'
  title: string
  explanation: string
}

export type MemorySignal = {
  id: string
  organizationId: string
  siteId: string
  category: OperationalSignalCategory
  trigger: {
    type: OperationalSignalTriggerType
    reason: OperationalSignalReason
  }
  severity: OperationalSignalSeverity
  importance: OperationalImportance
  urgency: OperationalUrgency
  state: OperationalSignalState
  actionability: OperationalActionability
  origin: OperationalSignalOrigin
  facts: SignalFact[]
  rules: SignalRule[]
  sources: SourceRef[]
  actions: SuggestedAction[]
  confidence: number | null
  dedupeKey: string
  detectedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolvedBy: SignalResolution | null
}

/** Annotation portée par les anciens read models pendant la migration. */
export type OperationalSignalMeta = {
  category: OperationalSignalCategory
  trigger: {
    type: OperationalSignalTriggerType
    reason: OperationalSignalReason
  }
  actionability: OperationalActionability
  origin: OperationalSignalOrigin
  dedupeKey: string
  sources: SourceRef[]
}

export type MemoryEvent = {
  id: string
  organizationId: string
  siteId: string
  type:
    | 'action_created'
    | 'action_completed'
    | 'visit_validated'
    | 'meeting_closed'
    | 'photo_added'
    | 'proof_added'
    | 'company_linked'
    | 'stakeholder_created'
    | 'decision_recorded'
    | 'deadline_changed'
  occurredAt: string
  sourceType: string
  sourceId: string
  payload: Record<string, string | number | boolean | null>
}
