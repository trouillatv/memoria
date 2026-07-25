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
export type OperationalSignalTrigger =
  | { type: 'old_action'; reason: 'object_aging' | 'deadline_overdue' }
  | { type: 'open_reserve'; reason: 'object_aging' }
  | { type: 'missing_company'; reason: 'company_not_linked' | 'company_not_created' | 'company_archived' }
  | { type: 'missing_contact'; reason: 'contact_not_identified' }
  | { type: 'missing_attachment'; reason: 'attachment_missing' }
  | { type: 'planning_conflict'; reason: 'planning_conflict' }
  | { type: 'promise'; reason: 'promise_expired' }
  | { type: 'question'; reason: 'question_unanswered' }
  | { type: 'contradiction'; reason: 'facts_incompatible' }
  | { type: 'staleness'; reason: 'object_aging' | 'activity_missing' }
  | { type: 'health'; reason: 'activity_missing' }
  | { type: 'imminent_passage'; reason: 'passage_imminent' }
  | { type: 'overdue_deadline'; reason: 'deadline_overdue' }

/** Union de compatibilité pour les catalogues et métadonnées de migration. */
export type OperationalSignalTriggerType = OperationalSignalTrigger['type']
export type OperationalSignalReason = OperationalSignalTrigger['reason']

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
  occurredAt: string | null
  dueAt: string | null
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
  trigger: OperationalSignalTrigger
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
  trigger: OperationalSignalTrigger
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
