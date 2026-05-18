// Preuve d'accès site — prise / restitution / incident (migration 070).
//
// Doctrine MemorIA : preuve d'accès, PAS registre de détention.
//   - Aucune lecture/écriture de "qui détient" : pas exposé par ces helpers.
//   - created_by reste en base (audit interne) mais N'EST PAS retourné ici.
//   - prise/restitution = routine → JAMAIS embeddé (la routine n'est pas une
//     mémoire). Seul l'incident, via l'anomalie chaînée, nourrit les
//     résonances/persistances existantes.

import { createAdminClient } from '@/lib/supabase/admin'

export type AccessEventType = 'pickup' | 'return' | 'incident'
export type AccessEventSource = 'pc_securite' | 'spi' | 'accueil' | 'autre'

export interface DbInterventionAccessEvent {
  id: string
  intervention_id: string
  type: AccessEventType
  source: AccessEventSource
  note: string | null
  photo_id: string | null
  anomaly_id: string | null
  requires_return: boolean
  deferred: boolean
  occurred_at: string
  created_at: string
  // L'auteur reste en base (audit interne) mais n'est JAMAIS projeté ici —
  // doctrine : pas de surveillance individuelle.
}

const PUBLIC_COLUMNS =
  'id, intervention_id, type, source, note, photo_id, anomaly_id, requires_return, deferred, occurred_at, created_at'

export async function listAccessEventsByIntervention(
  interventionId: string,
): Promise<DbInterventionAccessEvent[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_access_events')
    .select(PUBLIC_COLUMNS)
    .eq('intervention_id', interventionId)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbInterventionAccessEvent[]
}

export async function createAccessEvent(input: {
  intervention_id: string
  type: AccessEventType
  source: AccessEventSource
  note?: string | null
  photo_id?: string | null
  anomaly_id?: string | null
  requires_return?: boolean
  deferred?: boolean
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_access_events')
    .insert({
      intervention_id: input.intervention_id,
      type: input.type,
      source: input.source,
      note: input.note ?? null,
      photo_id: input.photo_id ?? null,
      anomaly_id: input.anomaly_id ?? null,
      // requires_return n'a de sens que pour pickup ; neutre (true) sinon.
      requires_return: input.type === 'pickup' ? input.requires_return ?? true : true,
      // deferred n'a de sens que pour return.
      deferred: input.type === 'return' ? input.deferred ?? false : false,
      created_by: input.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

/**
 * Logique de clôture PURE (testable sans DB) — sobre, jamais bloquante.
 * Un accès a été pris avec restitution attendue, mais rien ne la documente
 * (ni restitution, ni incident). On ne PAIRE pas les prises individuelles :
 * lecture au niveau intervention, fidèle à « une prise enregistrée sans
 * restitution ». Un pickup requires_return=false (badge jetable / conservé)
 * ne déclenche jamais la demande.
 */
export function computePickupNeedsReturn(
  events: Pick<DbInterventionAccessEvent, 'type' | 'requires_return'>[],
): boolean {
  const hasPickupNeedingReturn = events.some(
    (e) => e.type === 'pickup' && e.requires_return,
  )
  const hasResolution = events.some(
    (e) => e.type === 'return' || e.type === 'incident',
  )
  return hasPickupNeedingReturn && !hasResolution
}

export async function getAccessReturnStatus(
  interventionId: string,
): Promise<{ pickupNeedsReturn: boolean }> {
  const events = await listAccessEventsByIntervention(interventionId)
  return { pickupNeedsReturn: computePickupNeedsReturn(events) }
}

/** Le bloc accès n'est proposé que sur les sites flaggés (anti-surcharge). */
export async function getSiteRequiresAccessHandover(
  siteId: string,
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sites')
    .select('requires_access_handover')
    .eq('id', siteId)
    .maybeSingle()
  return Boolean(
    (data as { requires_access_handover?: boolean } | null)?.requires_access_handover,
  )
}
