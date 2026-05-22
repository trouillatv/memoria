// Détecteur handover_acknowledged — enveloppe DB (server-only).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MemorySignal } from '../types'
import type { HandoverPayload } from '@/types/db'
import {
  buildHandoverAcknowledgedSignals,
  ACK_WINDOW_DAYS,
  type AckBriefInput,
} from './handover-acknowledged.logic'

export async function detectHandoverAcknowledged(): Promise<MemorySignal[]> {
  const sb = createAdminClient()
  const sinceIso = new Date(Date.now() - ACK_WINDOW_DAYS * 86_400_000).toISOString()

  const { data } = await sb
    .from('handover_briefs')
    .select('id, acknowledged_at, payload')
    .eq('status', 'acknowledged')
    .gte('acknowledged_at', sinceIso)

  type Row = { id: string; acknowledged_at: string | null; payload: HandoverPayload | null }

  const briefs: AckBriefInput[] = ((data ?? []) as Row[])
    .filter((b): b is Row & { acknowledged_at: string } => !!b.acknowledged_at)
    .map((b) => ({
      id: b.id,
      acknowledgedAt: b.acknowledged_at,
      sites: (b.payload?.sites ?? []).map((s) => ({ site_id: s.site_id, site_name: s.site_name })),
    }))

  return buildHandoverAcknowledgedSignals(briefs, Date.now())
}
