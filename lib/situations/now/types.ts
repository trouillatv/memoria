import type { SituationCapability } from '../situation'

export type NowTone = 'neutral' | 'amber' | 'red'
export type NowIcon = 'clock' | 'calendar' | 'document' | 'warning'

export type NowAction = {
  kind: SituationCapability['kind']
  label: string
  href: string
}

export type NowCard = {
  id: string
  icon: NowIcon
  tone: NowTone
  title: string
  description: string | null
  siteLabel: string
  organizationLabel?: string
  timingLabel?: string
  sourceLabel?: string
  primaryAction?: NowAction
  secondaryActions: NowAction[]
}
