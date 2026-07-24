/** Pure rules shared by the visit-preparation read model and its UI. */

export type VisitPreparationPhase = 'first_visit' | 'follow_up' | 'previsit_ao' | 'history'

export interface VisitPreparationFacts {
  hasCompletedVisit: boolean
  hasActiveTender: boolean
  isFinished: boolean
}

export type VisitPreparationActivityStatus = 'validated' | 'in_progress' | 'very_recent'

export interface VisitPreparationActivityFacts {
  endedAt: string | null
  startedAt: string | null
  now?: string
}

/**
 * Une activité ouverte n'est jamais masquée : elle est rendue comme « en cours ».
 * Une activité clôturée aujourd'hui reste « très récente » pour ne pas perdre le
 * signal terrain, tandis qu'une activité clôturée plus ancienne est validée.
 */
export function classifyVisitPreparationActivity(
  facts: VisitPreparationActivityFacts,
): VisitPreparationActivityStatus {
  if (!facts.endedAt) return 'in_progress'
  const now = new Date(facts.now ?? new Date().toISOString()).getTime()
  const ended = new Date(facts.endedAt).getTime()
  if (!Number.isFinite(now) || !Number.isFinite(ended)) return 'validated'
  return now - ended < 86_400_000 ? 'very_recent' : 'validated'
}

export function resolveVisitPreparationPhase(facts: VisitPreparationFacts): VisitPreparationPhase {
  if (facts.isFinished) return 'history'
  if (facts.hasActiveTender) return 'previsit_ao'
  if (facts.hasCompletedVisit) return 'follow_up'
  return 'first_visit'
}

export interface VisitPreparationSummaryFacts {
  openActions: number
  openReserves: number
  nextPassageLabel: string | null
  criticalPoint: string | null
}

export type PreparationReminderKind = 'blockage' | 'overdue_action' | 'deadline' | 'watchpoint' | 'open_activity' | 'proof'

export interface PreparationReminder {
  kind: PreparationReminderKind
  text: string
  sourceId: string | null
  sourceHref: string | null
}

export interface PreparationReminderFacts {
  blockages: PreparationReminder[]
  overdueActions: PreparationReminder[]
  imminentDeadlines: PreparationReminder[]
  watchpoints: PreparationReminder[]
  openActivities: PreparationReminder[]
  proofs: PreparationReminder[]
}

export type PreparationObjectiveKind = 'scheduled' | 'action' | 'deadline' | 'reserve' | 'watchpoint' | 'decision'

export interface PreparationObjective {
  kind: PreparationObjectiveKind
  text: string
  sourceId: string | null
  sourceHref: string | null
}

export interface PreparationObjectiveFacts {
  scheduled: PreparationObjective | null
  action: PreparationObjective | null
  deadline: PreparationObjective | null
  reserve: PreparationObjective | null
  watchpoint: PreparationObjective | null
  decision: PreparationObjective | null
}

/** Pourquoi le conducteur se déplace : règle métier, sans génération. */
export function selectPreparationObjective(
  facts: PreparationObjectiveFacts,
): PreparationObjective | null {
  return facts.scheduled ?? facts.action ?? facts.deadline ?? facts.reserve ?? facts.watchpoint ?? facts.decision ?? null
}

/**
 * Extrait quelques faits courts des récits persistés sans les réécrire.
 * La fonction ne produit aucune inférence : elle découpe, déduplique et borne
 * les phrases afin que l'écran de préparation reste lisible.
 */
export function selectNarrativeHighlights(narratives: string[], limit = 5): string[] {
  const seen = new Set<string>()
  const highlights: string[] = []
  for (const narrative of narratives) {
    const sentences = narrative
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim().replace(/^[-•]\s*/, ''))
      .filter(Boolean)
    for (const sentence of sentences) {
      const key = sentence
        .toLocaleLowerCase('fr-FR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      highlights.push(sentence)
      if (highlights.length >= limit) return highlights
    }
  }
  return highlights
}

export interface PreparationAIContextFacts {
  narratives: Array<{ text: string; status: 'draft' | 'validated'; occurredAt: string }>
  activities: Array<{ kind: 'visit' | 'meeting'; title: string; status: string; photoCount: number; memoCount: number }>
  changedSinceVenue: string[]
  openActions: string[]
  overdueActions: string[]
  deadlines: string[]
  decisions: string[]
  reserves: string[]
  watchpoints: string[]
  proofs: string[]
}

/** Sérialise le contexte déjà calculé pour l'IA, sans nouvelle lecture ni inférence. */
export function buildVisitObjectiveContextLines(facts: PreparationAIContextFacts): string[] {
  const lines: string[] = []
  if (facts.narratives.length) {
    lines.push(...facts.narratives.map((narrative) => `Résumé persisté (${narrative.status}, ${narrative.occurredAt}) : ${narrative.text}`))
  }
  if (facts.activities.length) {
    lines.push(...facts.activities.map((activity) => `Activité ${activity.status === 'in_progress' ? 'en cours — non consolidé' : activity.status} (${activity.kind}) : ${activity.title} · ${activity.photoCount} photo(s) · ${activity.memoCount} note(s)`))
  }
  if (facts.changedSinceVenue.length) lines.push(`Changements depuis la dernière venue : ${facts.changedSinceVenue.join(' ; ')}`)
  if (facts.openActions.length) lines.push(`Actions ouvertes : ${facts.openActions.join(' ; ')}`)
  if (facts.overdueActions.length) lines.push(`Actions en retard : ${facts.overdueActions.join(' ; ')}`)
  if (facts.deadlines.length) lines.push(`Échéances : ${facts.deadlines.join(' ; ')}`)
  if (facts.decisions.length) lines.push(`Décisions : ${facts.decisions.join(' ; ')}`)
  if (facts.reserves.length) lines.push(`Réserves : ${facts.reserves.join(' ; ')}`)
  if (facts.watchpoints.length) lines.push(`Points de vigilance : ${facts.watchpoints.join(' ; ')}`)
  if (facts.proofs.length) lines.push(`Preuves récentes : ${facts.proofs.join(' ; ')}`)
  return lines
}

/** Sélectionne les rappels « Avant de partir » sans score opaque ni IA. */
export function selectPreparationReminders(
  facts: PreparationReminderFacts,
  limit = 5,
): PreparationReminder[] {
  const ordered = [
    ...facts.blockages,
    ...facts.overdueActions,
    ...facts.imminentDeadlines,
    ...facts.watchpoints,
    ...facts.openActivities,
    ...facts.proofs,
  ]
  const seen = new Set<string>()
  return ordered.filter((item) => {
    const key = item.sourceId ?? item.text
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}

export function buildVisitPreparationSummary(facts: VisitPreparationSummaryFacts): string[] {
  const lines: string[] = []
  if (facts.openActions > 0) {
    lines.push(`${facts.openActions} action${facts.openActions > 1 ? 's' : ''} reste${facts.openActions > 1 ? 'nt' : ''} ouverte${facts.openActions > 1 ? 's' : ''}.`)
  }
  if (facts.openReserves > 0) {
    lines.push(`${facts.openReserves} réserve${facts.openReserves > 1 ? 's' : ''} reste${facts.openReserves > 1 ? 'nt' : ''} à lever.`)
  }
  if (facts.nextPassageLabel) lines.push(`Prochain passage : ${facts.nextPassageLabel}.`)
  if (facts.criticalPoint) lines.push(`Point critique : ${facts.criticalPoint}.`)
  if (lines.length === 0) lines.push('Aucun point bloquant identifié pour le moment.')
  return lines
}
