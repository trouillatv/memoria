// Détecteur memory_awaiting — enveloppe DB (server-only).
//
// Récupère les passations partagées non reconnues (status='shared') et délègue
// toute la logique au cœur pur testable.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import type { MemorySignal } from '../types'
import type { HandoverPayload } from '@/types/db'
import { buildMemoryAwaitingSignals, type AwaitingBriefInput } from './memory-awaiting.logic'

export async function detectMemoryAwaiting(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return []

  // status='shared' = partagé mais PAS encore reconnu (la reconnaissance fait
  // passer à 'acknowledged'). On exclut les archivés (deleted_at).
  const { data } = await sb
    .from('handover_briefs')
    .select('id, shared_at, access_count, payload')
    .in('organization_id', orgIds)
    .eq('status', 'shared')
    .is('deleted_at', null)
    .not('shared_at', 'is', null)

  type Row = {
    id: string
    shared_at: string | null
    access_count: number | null
    payload: HandoverPayload | null
  }

  const briefs: AwaitingBriefInput[] = ((data ?? []) as Row[])
    .filter((b): b is Row & { shared_at: string } => !!b.shared_at)
    .map((b) => ({
      id: b.id,
      sharedAt: b.shared_at,
      consulted: (b.access_count ?? 0) > 0,
      sites: (b.payload?.sites ?? []).map((s) => ({
        site_id: s.site_id,
        site_name: s.site_name,
      })),
    }))

  return buildMemoryAwaitingSignals(briefs, Date.now())
}
