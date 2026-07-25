export type SituationKind =
  | 'expired_promise'
  | 'unconfirmed_promise'

export type SituationSeverity = 'info' | 'warning' | 'critical'

export type SituationSource = {
  type: string
  id: string
  label: string
  href: string
}

export type SituationCapability = {
  kind: 'open_source'
  label: string
  href: string
}

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
  capabilities: SituationCapability[]
}
