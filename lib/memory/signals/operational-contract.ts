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
  key: string
  value: string | number | boolean | null
  sourceIds: string[]
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
  presentations: SignalPresentation[]
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
