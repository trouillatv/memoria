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

export type MemorySignal = {
  id: string
  organizationId: string
  siteId: string
  category: OperationalSignalCategory
  severity: OperationalSignalSeverity
  state: OperationalSignalState
  actionability: OperationalActionability
  origin: OperationalSignalOrigin
  title: string
  explanation: string
  sources: SourceRef[]
  suggestedAction: SuggestedAction | null
  confidence: number | null
  dedupeKey: string
  detectedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
}

/** Annotation portée par les anciens read models pendant la migration. */
export type OperationalSignalMeta = {
  category: OperationalSignalCategory
  actionability: OperationalActionability
  origin: OperationalSignalOrigin
  dedupeKey: string
  sources: SourceRef[]
}
