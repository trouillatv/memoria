import type { SituationCapability } from '../situation'

export type AttentionTone = 'neutral' | 'amber' | 'red'
export type AttentionIcon = 'calendar' | 'question' | 'document' | 'warning'

export type AttentionAction = {
  kind: SituationCapability['kind']
  label: string
  href: string
}

export type AttentionCard = {
  id: string
  icon: AttentionIcon
  tone: AttentionTone
  title: string
  description: string | null
  siteLabel: string
  organizationLabel?: string
  timingLabel?: string
  sourceLabel?: string
  primaryAction?: AttentionAction
  secondaryActions: AttentionAction[]
}
