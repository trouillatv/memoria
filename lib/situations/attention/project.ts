import type { Situation, SituationCapability, SituationKind } from '../situation'
import type { AttentionAction, AttentionCard, AttentionIcon, AttentionTone } from './types'
import { PRIORITY_WEIGHTS, DEFAULT_PRIORITY_CONTEXT } from './priority-weights'
import type { PriorityContext } from './priority-weights'

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

type UrgencyKey = keyof typeof PRIORITY_WEIGHTS.urgency

function urgencyKey(dueAt: string | null, now: Date): UrgencyKey {
  if (!dueAt) return 'none'
  const due = new Date(dueAt)
  due.setUTCHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays <= 7) return 'thisWeek'
  return 'none'
}

type StalenessKey = keyof typeof PRIORITY_WEIGHTS.staleness

function stalenessKey(detectedAt: string, now: Date): StalenessKey {
  const days = Math.floor((now.getTime() - new Date(detectedAt).getTime()) / 86_400_000)
  if (days <= 7)  return 'days0to7'
  if (days <= 14) return 'days8to14'
  if (days <= 21) return 'days15to21'
  if (days <= 30) return 'days22to30'
  return 'daysOver30'
}

/**
 * Score de priorisation métier (0–105). Quatre dimensions :
 *   impact (0–40)    : type de situation × risque terrain
 *   urgence (0–30)   : dueAt vs aujourd'hui (calendaire)
 *   ancienneté (0–20): signal actif sans résolution depuis longtemps (plafonné)
 *   contexte (0–15)  : activité programmée sur le chantier aujourd'hui
 *
 * Poids dans PRIORITY_WEIGHTS — ajustables sans réécrire l'algorithme.
 * L'utilisateur ne voit jamais le score, seulement l'ordre résultant.
 */
function priorityScore(situation: Situation, now: Date, context: PriorityContext): number {
  const w = PRIORITY_WEIGHTS
  const impact     = (w.impact as Record<string, number>)[situation.kind] ?? 0
  const urgency    = w.urgency[urgencyKey(situation.timing.dueAt, now)]
  const staleness  = w.staleness[stalenessKey(situation.timing.detectedAt, now)]
  const contextBonus = context.siteIdsToday.has(situation.site.id) ? w.context.siteScheduledToday : 0
  return impact + urgency + staleness + contextBonus
}

export function projectSituationForAttention(
  situation: Situation | null,
  now = new Date(),
  context: PriorityContext = DEFAULT_PRIORITY_CONTEXT,
): AttentionCard | null {
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
    priority: priorityScore(situation, now, context),
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

export function projectAttentionCards(
  situations: Array<Situation | null>,
  now = new Date(),
  context: PriorityContext = DEFAULT_PRIORITY_CONTEXT,
): AttentionCard[] {
  return situations.flatMap((situation) => {
    const card = projectSituationForAttention(situation, now, context)
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
