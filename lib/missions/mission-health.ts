export type MissionHealthTone = 'red' | 'orange' | 'green'

export interface MissionHealthInput {
  active: boolean
  cadence: string
  lastInterventionDate: string | null
  nextInterventionDate: string | null
  openAnomalyCount: number
  assignedTeam: { id: string; name: string; color: string | null } | null
}

export interface MissionHealth {
  level: MissionHealthTone
  chips: Array<{ tone: MissionHealthTone; label: string }>
  overdueDays: number
  never: boolean
  sansProchaine: boolean
  sansEquipe: boolean
  anomalies: boolean
}

const OVERDUE_THRESHOLD_DAYS: Record<string, number> = {
  daily: 3,
  weekly: 10,
  biweekly: 18,
  monthly: 38,
  on_demand: Infinity,
}

export function buildMissionHealth(mission: MissionHealthInput, todayIso: string): MissionHealth {
  const recurring = mission.cadence !== 'on_demand'
  const hasFutureNext = !!mission.nextInterventionDate && mission.nextInterventionDate >= todayIso
  const threshold = OVERDUE_THRESHOLD_DAYS[mission.cadence] ?? Infinity

  const never = mission.active && recurring && !mission.lastInterventionDate && !hasFutureNext
  let overdueDays = 0
  let overdue = false
  if (mission.active && recurring && mission.lastInterventionDate && !hasFutureNext) {
    overdueDays = daysBetweenIso(mission.lastInterventionDate, todayIso)
    overdue = overdueDays > threshold
  }

  const anomalies = mission.openAnomalyCount > 0
  const sansProchaine = mission.active && recurring && !overdue && !never && !hasFutureNext
  const sansEquipe = mission.active && !mission.assignedTeam

  const chips: MissionHealth['chips'] = []
  if (overdue) chips.push({ tone: 'red', label: `${overdueDays} j de retard` })
  if (anomalies) chips.push({ tone: 'red', label: `${mission.openAnomalyCount} anomalie${mission.openAnomalyCount > 1 ? 's' : ''}` })
  if (never) chips.push({ tone: 'orange', label: 'jamais réalisée' })
  if (sansProchaine) chips.push({ tone: 'orange', label: 'sans prochaine' })
  if (sansEquipe) chips.push({ tone: 'orange', label: 'sans équipe' })

  const level: MissionHealthTone = chips.some((chip) => chip.tone === 'red')
    ? 'red'
    : chips.some((chip) => chip.tone === 'orange')
      ? 'orange'
      : 'green'

  if (chips.length === 0) chips.push({ tone: 'green', label: 'en rythme' })

  return { level, chips, overdueDays, never, sansProchaine, sansEquipe, anomalies }
}

export function scoreMissionSeverity(health: MissionHealth, openAnomalyCount: number): number {
  return (health.overdueDays > 0 ? 1000 + health.overdueDays : 0)
    + (health.anomalies ? 300 + openAnomalyCount * 10 : 0)
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime()
  const to = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}
