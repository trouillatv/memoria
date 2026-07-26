import type { Situation, SituationCapability, SituationKind } from '../situation'
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
    case 'overdue_action':
    case 'planning_conflict':
      return 'calendar'
    case 'pending_debrief':
      return 'document'
    case 'stale_action':
    case 'open_reserve':
      return 'warning'
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
  return situation.kind === 'expired_promise'
    || situation.kind === 'unconfirmed_promise'
    || situation.kind === 'stale_action'
    || situation.kind === 'overdue_action'
    || situation.kind === 'open_reserve'
    || situation.kind === 'planning_conflict'
    || situation.kind === 'pending_debrief'
}

// ─── Score métier ────────────────────────────────────────────────────────────

/** Impact par type : que peut rater le conducteur si ça reste non traité ? */
const IMPACT_SCORE: Record<SituationKind, number> = {
  overdue_action:      40,  // deadline dépassée — urgence maximale
  planning_conflict:   40,  // ressources bloquées — urgence maximale
  expired_promise:     35,  // engagement non tenu
  pending_debrief:     30,  // connaissance perdue après visite
  open_reserve:        25,  // risque non traité
  unconfirmed_promise: 20,  // manque de clarté
  stale_action:        10,  // ancienne mais sans deadline
}

/**
 * Score de priorisation métier (0–90). Critères de Vincent :
 *   impact (0–40)   : type de situation × risque terrain
 *   urgence (5–30)  : âge du problème (ageDays)
 *   ancienneté (0–20) : signal non résolu depuis longtemps
 *
 * L'utilisateur ne voit jamais le score, seulement l'ordre résultant.
 */
function priorityScore(situation: Situation, now: Date): number {
  const ageDays = situation.timing.ageDays ?? 0
  const urgency = ageDays > 30 ? 30 : ageDays > 7 ? 20 : ageDays > 0 ? 10 : 5

  const signalDays = Math.floor(
    (now.getTime() - new Date(situation.timing.detectedAt).getTime()) / 86_400_000,
  )
  const staleness = signalDays > 14 ? 20 : signalDays > 7 ? 10 : signalDays > 2 ? 5 : 0

  return (IMPACT_SCORE[situation.kind] ?? 0) + urgency + staleness
}

export function projectSituationForAttention(situation: Situation | null, now = new Date()): AttentionCard | null {
  if (!situation || !isSupportedSituation(situation)) return null

  const actions = situation.capabilities.flatMap((capability) => {
    const action = actionFromCapability(capability)
    return action ? [action] : []
  })
  const [primaryAction, ...secondaryActions] = actions

  // Gestes de MUTATION : portés à part (avec le subject), jamais comme des liens.
  const resolutions = situation.capabilities.flatMap((capability) =>
    capability.kind === 'open_source' ? [] : [{ kind: capability.kind, label: capability.label }],
  )

  return {
    id: situation.id,
    icon: iconOfSituation(situation),
    tone: toneOfSituation(situation),
    priority: priorityScore(situation, now),
    title: situation.title,
    description: situation.explanation,
    siteLabel: situation.site.name,
    organizationLabel: situation.site.organizationName ?? undefined,
    timingLabel: situation.timing.label ?? undefined,
    sourceLabel: situation.source?.label ?? undefined,
    primaryAction,
    secondaryActions,
    // Résoluble seulement si un subject est présent ET des gestes existent.
    subject: resolutions.length > 0 ? situation.subject : null,
    resolutions,
  }
}

export function projectAttentionCards(situations: Array<Situation | null>, now = new Date()): AttentionCard[] {
  return situations.flatMap((situation) => {
    const card = projectSituationForAttention(situation, now)
    return card ? [card] : []
  })
}

// Tiebreaker par sévérité quand deux cartes ont le même score.
const CARD_TONE_RANK: Record<AttentionTone, number> = { red: 0, amber: 1, neutral: 2 }

/**
 * Trie les cartes par SCORE MÉTIER décroissant (impact × urgence × ancienneté).
 * À score égal, le ton (rouge → ambre → neutre) départage. Ne mute pas l'entrée.
 */
export function sortAttentionCards(cards: ReadonlyArray<AttentionCard>): AttentionCard[] {
  return [...cards].sort((a, b) =>
    b.priority !== a.priority
      ? b.priority - a.priority
      : CARD_TONE_RANK[a.tone] - CARD_TONE_RANK[b.tone],
  )
}
