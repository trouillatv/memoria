export type PlanningItemKind = 'task' | 'milestone'
export type PlanningTemporalPrecision = 'day' | 'week' | 'range' | 'unknown'
export type PlanningDateBasis = 'explicit_document' | 'document_context' | 'human_confirmed'
export type PlanningItemStatus = 'planned' | 'superseded' | 'cancelled'

export interface PlanningDateInput {
  plannedStart?: string | null
  plannedEnd?: string | null
  temporalPrecision?: PlanningTemporalPrecision
}

export function validatePlanningDates(input: PlanningDateInput): { start: string | null; end: string | null } {
  const parse = (value: string | null | undefined): string | null => {
    if (value == null || value === '') return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Date Planning invalide : ${value}`)
    return value
  }
  const start = parse(input.plannedStart)
  const end = parse(input.plannedEnd)
  if (start && end && end < start) throw new Error('La fin du planning ne peut pas précéder son début')
  if (input.temporalPrecision && input.temporalPrecision !== 'unknown' && !start) {
    throw new Error('Une précision temporelle exige une date de début')
  }
  return { start, end }
}
