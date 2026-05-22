// Heatmap mémoire / continuité — CŒUR PUR (sans server-only → testable).
//
// PAS une heatmap d'activité (ni heures, ni productivité, ni RH). Chaque jour
// reçoit la TEINTE de son événement mémoriel dominant : on transforme le temps
// opérationnel en TEMPS MÉMORIEL. Condensation poétique du moteur, pas analytics.
//
// Priorité des teintes (du plus « abouti » au plus brut) :
//   🟢 vert  — continuité confirmée  : une passation reconnue ce jour
//   🟠 ambre — transmission          : une passation partagée ce jour
//   🔵 bleu  — mémoire récente       : un « à savoir » noté ce jour
//   🔴 rouge — (rare) fragilité      : une anomalie ouverte ce jour, rien d'autre
//   ·  vide  — pas d'événement mémoriel

export type MemoryTone = 'green' | 'amber' | 'blue' | 'red'

export interface HeatmapCell {
  /** yyyy-mm-dd */
  date: string
  tone: MemoryTone | null
}

export interface MemoryHeatmapInput {
  /** Dates (ISO ou yyyy-mm-dd) des passations reconnues. */
  acknowledgedDates: string[]
  /** Dates des passations partagées. */
  sharedDates: string[]
  /** Dates des « à savoir » notés. */
  noteDates: string[]
  /** Dates des anomalies ouvertes (rare). */
  openAnomalyDates: string[]
}

function toDay(iso: string): string {
  return iso.slice(0, 10)
}

function dayIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Pur & déterministe : un tableau de `days` cellules (de la plus ancienne à
 * aujourd'hui), chacune avec sa teinte mémorielle dominante.
 */
export function buildMemoryHeatmap(
  input: MemoryHeatmapInput,
  nowMs: number,
  days: number,
): HeatmapCell[] {
  const ack = new Set(input.acknowledgedDates.map(toDay))
  const shared = new Set(input.sharedDates.map(toDay))
  const note = new Set(input.noteDates.map(toDay))
  const anomaly = new Set(input.openAnomalyDates.map(toDay))

  const cells: HeatmapCell[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = dayIso(nowMs - i * 86_400_000)
    let tone: MemoryTone | null = null
    if (ack.has(d)) tone = 'green'
    else if (shared.has(d)) tone = 'amber'
    else if (note.has(d)) tone = 'blue'
    else if (anomaly.has(d)) tone = 'red'
    cells.push({ date: d, tone })
  }
  return cells
}
