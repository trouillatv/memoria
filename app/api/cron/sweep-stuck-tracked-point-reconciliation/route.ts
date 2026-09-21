// P0-A (suite REVIEW Vincent 2026-09-21) — filet de second niveau pour
// reconcileTrackedPointMutationBestEffort (lib/db/tracked-point-live-writer-mutation-adapter.ts).
//
// Constat de la review : un échec ponctuel de réconciliation après mutation CBO (refus RPC ou
// exception) n'était que journalisé (console.error), sans trace durable ni rejeu — on pouvait
// recréer la famille de défaut que P0-A corrige (thread jamais revisité). Ce cron REJOUE les
// échecs persistés (tracked_point_reconcile_failure, migration 426), il n'alerte pas
// seulement : reconcileTrackedPointUnit recalcule toujours le plan+fingerprint live, le rejeu
// est donc idempotent (mêmes critères #3/#4 que P0-A).
//
// Modèle : app/api/cron/sweep-stuck-reconciliation/route.ts (autre étage du pipeline —
// site_reports.canonical_reconciled_at — pas le Live Writer, distinct de celui-ci).
//
// Auth : Bearer CRON_SECRET, même pattern que sweep-stuck-tenders/sweep-stuck-reconciliation.

import { NextResponse } from 'next/server'
import { replayPendingTrackedPointReconcileFailures } from '@/lib/db/tracked-point-live-writer-mutation-adapter'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Une réévaluation post-mutation porte sur UN thread déjà résolu (pas un corpus entier) — bien
 * plus léger que le rejeu d'une visite (~6 min mesurées ailleurs). Un lot de 20 par passage
 * suffit largement à absorber le débit réel sans dépasser maxDuration.
 */
const MAX_REPLAYS_PER_RUN = 20

/** Ne jamais rejouer une tentative encore potentiellement en vol (best-effort concurrent). */
const REPLAY_THRESHOLD_MS = 15 * 60 * 1000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const outcome = await replayPendingTrackedPointReconcileFailures(MAX_REPLAYS_PER_RUN, REPLAY_THRESHOLD_MS)

    if (outcome.found > 0) {
      console.warn(
        JSON.stringify({
          service: 'sweep-stuck-tracked-point-reconciliation',
          ...outcome,
          ts: new Date().toISOString(),
        }),
      )
    }

    return NextResponse.json({ ok: true, ...outcome })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sweep-stuck-tracked-point-reconciliation] failed:', e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
