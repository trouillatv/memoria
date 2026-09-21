// P0-B1 (mandat Vincent, 2026-09-21, suite audit P0-B) — filet de résilience pour
// reconcileSubjectThreads (lib/documents/subject-reconciliation.ts), étape 12 de l'extraction
// historique (lib/documents/extract-historical-pv.ts).
//
// Constat P0-B : un échec de réconciliation des fils thématiques n'était que journalisé
// (console.error), sans trace durable ni rejeu — le run restait ready_for_review avec des
// subject_thread_id NULL indéfiniment, invisibles au resolver CBO puis au Live Writer. Ce cron
// REJOUE les échecs persistés (subject_thread_reconcile_failure, migration 427) ; il n'alerte
// pas seulement : reconcileSubjectThreads ne traite que les propositions avec
// subject_thread_id IS NULL, le rejeu est donc idempotent.
//
// Modèle : app/api/cron/sweep-stuck-tracked-point-reconciliation/route.ts (P0-A, même
// doctrine — autre étage du pipeline).
//
// Auth : Bearer CRON_SECRET, même pattern que les autres sweeps.

import { NextResponse } from 'next/server'
import { replayPendingSubjectThreadReconcileFailures } from '@/lib/documents/subject-reconciliation'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Un run réévalué reste limité (~50-150 propositions) — 20 par passage suffit largement. */
const MAX_REPLAYS_PER_RUN = 20

/** Ne jamais rejouer une tentative encore potentiellement en vol. */
const REPLAY_THRESHOLD_MS = 15 * 60 * 1000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await replayPendingSubjectThreadReconcileFailures(MAX_REPLAYS_PER_RUN, REPLAY_THRESHOLD_MS)

    if (outcome.found > 0) {
      console.warn(
        JSON.stringify({
          service: 'sweep-stuck-subject-thread-reconciliation',
          ...outcome,
          ts: new Date().toISOString(),
        }),
      )
    }

    return NextResponse.json({ ok: true, ...outcome })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sweep-stuck-subject-thread-reconciliation] failed:', e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
