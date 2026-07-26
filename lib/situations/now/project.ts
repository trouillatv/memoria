import type { Situation, SituationCapability } from '../situation'
import type { NowAction, NowCard, NowIcon, NowTone } from './types'

function toneOfSituation(situation: Situation): NowTone {
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

function iconOfSituation(situation: Situation): NowIcon {
  switch (situation.kind) {
    case 'expired_promise':
      return 'calendar'
    case 'unconfirmed_promise':
      return 'document'
    default:
      return 'warning'
  }
}

function isPromiseSituation(situation: Situation): boolean {
  return situation.kind === 'expired_promise' || situation.kind === 'unconfirmed_promise'
}

// Gestes reconnus comme « À faire maintenant ». VIDE pour l'instant : la règle de
// projection directe des promesses vers Now n'est PAS encore définie — les gestes
// de résolution (T4 : réalisée/annulée/remplacée/suivi) vivent dans ATTENTION,
// pas dans Now. Une promesse reste donc hors de Now (comportement inchangé).
// Ajouter un kind ici — le jour où la règle existe — y fera entrer la famille.
const NOW_GESTURE_KINDS: ReadonlyArray<SituationCapability['kind']> = []

function isDirectCapability(capability: SituationCapability): boolean {
  return NOW_GESTURE_KINDS.includes(capability.kind)
}

function actionFromCapability(capability: SituationCapability): NowAction | null {
  // Seule une capacité Now-directe ET porteuse d'un lien produit une action Now.
  if (!isDirectCapability(capability) || !('href' in capability)) return null
  return {
    kind: capability.kind,
    label: capability.label,
    href: capability.href,
  }
}

function hasDirectCapability(situation: Situation): boolean {
  return situation.capabilities.some((capability) => isDirectCapability(capability))
}

export function projectSituationForNow(situation: Situation | null): NowCard | null {
  if (!situation || !isPromiseSituation(situation) || !hasDirectCapability(situation)) return null

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

export function projectNowCards(situations: Array<Situation | null>): NowCard[] {
  return situations.flatMap((situation) => {
    const card = projectSituationForNow(situation)
    return card ? [card] : []
  })
}
