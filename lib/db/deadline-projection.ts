/**
 * PostgREST `neq` seul élimine aussi les NULL SQL. Ce prédicat définit donc
 * explicitement la projection opérationnelle : les lignes legacy NULL restent
 * visibles, les imports historiques restent dans la mémoire documentaire.
 */
export const OPERATIONAL_DEADLINE_SOURCE_FILTER =
  'created_from.is.null,created_from.neq.historical_import'

export function isOperationalDeadline(input: {
  createdFrom: string | null
  status: string
}): boolean {
  return input.createdFrom !== 'historical_import'
    && (input.status === 'to_plan' || input.status === 'planned')
}
