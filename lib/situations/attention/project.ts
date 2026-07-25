import type { Situation, SituationCapability } from '../situation'
import type { AttentionAction, AttentionCard, AttentionIcon, AttentionTone } from './types'

function toneOfSituation(situation: Situation): AttentionTone {
  switch (situation.severity) {
    case 'critical':
      return 'red'
    case 'warning':
      return 'amber'
    case 'info':
    default:
      return 'neutral'
  }
}

function iconOfSituation(situation: Situation): AttentionIcon {
  switch (situation.kind) {
    case 'expired_promise':
      return 'calendar'
    case 'unconfirmed_promise':
      return 'question'
    default:
      return 'warning'
  }
}

function actionFromCapability(capability: SituationCapability): AttentionAction | null {
  switch (capability.kind) {
    case 'open_source':
      return {
        kind: capability.kind,
        label: capability.label,
        href: capability.href,
      }
    default:
      return null
  }
}

function isSupportedSituation(situation: Situation): boolean {
  return situation.kind === 'expired_promise' || situation.kind === 'unconfirmed_promise'
}

export function projectSituationForAttention(situation: Situation | null): AttentionCard | null {
  if (!situation || !isSupportedSituation(situation)) return null

  const actions = situation.capabilities.flatMap((capability) => {
    const action = actionFromCapability(capability)
    return action ? [action] : []
  })
  const [primaryAction, ...secondaryActions] = actions

  return {
    id: situation.id,
    icon: iconOfSituation(situation),
    tone: toneOfSituation(situation),
    title: situation.title,
    description: situation.explanation,
    siteLabel: situation.site.name,
    organizationLabel: situation.site.organizationName ?? undefined,
    timingLabel: situation.timing.label ?? undefined,
    sourceLabel: situation.source?.label ?? undefined,
    primaryAction,
    secondaryActions,
  }
}

export function projectAttentionCards(situations: Array<Situation | null>): AttentionCard[] {
  return situations.flatMap((situation) => {
    const card = projectSituationForAttention(situation)
    return card ? [card] : []
  })
}
