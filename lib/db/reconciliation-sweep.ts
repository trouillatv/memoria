import 'server-only'

// RECONCILIATION-RELIABILITY (P0, 2026-08-24) — filet de second niveau.
//
// Invariant tenu par ce module :
//   Toute visite éligible finit soit canonicalisée, soit dans un état d'erreur
//   observable et rejouable. Jamais silencieusement entre les deux.
//
// Pourquoi un second niveau. L'audit a mesuré DEUX modes de perte sur des données
// réelles, sur les DEUX chemins de production :
//   - visite terrain : réconciliation lancée en promesse détachée, tuée avec
//     l'instance serverless (corrigé à la source par `after()`) ;
//   - import de PV  : réconciliation pourtant `await`-ée, et malgré tout coincée
//     — une fonction tuée en cours ne passe ni par son `catch`, ni par son
//     `finally`.
// Aucun mécanisme de premier niveau ne survit à un kill brutal. Seule une reprise
// externe ferme l'invariant.
//
// Ce sweep REJOUE, il n'alerte pas seulement : alerter transformerait une panne
// silencieuse automatique en panne bruyante nécessitant un humain, alors que
// decideReconcileLock et l'idempotence permettent précisément la reprise.
//
// Modèle : app/api/cron/sweep-stuck-tenders/route.ts, même doctrine de filet.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  decideReconcileLock,
  acquireReconcileLock,
  RECONCILE_LOCK_TTL_MS,
} from '@/lib/db/canonical-subject-source-reconcile'

/**
 * Âge minimal d'une projection avant de la considérer abandonnée.
 *
 * 30 min = 2× le TTL du verrou (15 min), lui-même très au-dessus de la durée
 * réelle la plus longue mesurée (~6 min). Cette marge est délibérée : le sweep
 * ne doit JAMAIS toucher un run encore vivant. En cas de doute, il ne fait rien —
 * la visite sera reprise au passage suivant.
 */
export const SWEEP_THRESHOLD_MS = 30 * 60 * 1000

export interface StuckReconciliation {
  reportId: string
  siteId: string | null
  /** Non nul = visite matérialisée depuis un import de PV (mig 258). */
  extractionRunId: string | null
  projectedAt: string
  lockStartedAt: string | null
  error: string | null
}

/** Ce qu'une visite non réconciliée doit vérifier pour être reprise. Pur et testé. */
export function isSweepable(
  row: { debrief_projected_at: string | null; canonical_reconciled_at: string | null },
  nowMs: number,
  thresholdMs: number = SWEEP_THRESHOLD_MS,
): boolean {
  if (!row.debrief_projected_at) return false // jamais projetée : rien à réconcilier
  if (row.canonical_reconciled_at) return false // déjà faite
  return nowMs - Date.parse(row.debrief_projected_at) >= thresholdMs
}

/** Les visites projetées mais jamais canonicalisées, au-delà du seuil. */
export async function findStuckReconciliations(
  thresholdMs: number = SWEEP_THRESHOLD_MS,
  nowMs: number = Date.now(),
): Promise<StuckReconciliation[]> {
  const { data, error } = await createAdminClient()
    .from('site_reports')
    .select(
      'id, site_id, extraction_run_id, debrief_projected_at, ' +
        'canonical_reconciled_at, canonical_reconcile_started_at, canonical_reconcile_error',
    )
    .not('debrief_projected_at', 'is', null)
    .is('canonical_reconciled_at', null)
  if (error) throw error

  type Row = {
    id: string
    site_id: string | null
    extraction_run_id: string | null
    debrief_projected_at: string | null
    canonical_reconciled_at: string | null
    canonical_reconcile_started_at: string | null
    canonical_reconcile_error: string | null
  }

  return ((data ?? []) as unknown as Row[])
    .filter((r) => isSweepable(r, nowMs, thresholdMs))
    .map((r) => ({
      reportId: r.id,
      siteId: r.site_id,
      extractionRunId: r.extraction_run_id,
      projectedAt: r.debrief_projected_at!,
      lockStartedAt: r.canonical_reconcile_started_at,
      error: r.canonical_reconcile_error,
    }))
}

export type SweepOutcome =
  | 'reconciled'
  | 'already_done'
  | 'concurrent'
  | 'lock_lost'
  | 'failed'
  | 'no_site'

/**
 * Rejoue la réconciliation d'une visite coincée, par le chemin qui lui correspond.
 *
 * Le chemin terrain passe par `runCanonicalReconciliation`, exactement le point
 * d'entrée qu'`after()` aurait appelé : le sweep ne rejoue jamais une variante
 * appauvrie de ce qui aurait dû tourner.
 *
 * Le chemin import n'a pas d'équivalent extractible sans toucher à la server
 * action ; il est reproduit ici avec le MÊME verrou partagé (decideReconcileLock
 * + acquireReconcileLock), jamais un CAS recopié à la main.
 */
export async function replayReconciliation(item: StuckReconciliation): Promise<SweepOutcome> {
  if (!item.siteId) return 'no_site'

  if (!item.extractionRunId) {
    const { runCanonicalReconciliation } = await import('@/lib/visits/debrief-analysis')
    return await runCanonicalReconciliation({ reportId: item.reportId, siteId: item.siteId })
  }

  // ── Chemin import de PV historique ────────────────────────────────────────
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const { data: reportStatus } = await sb
    .from('site_reports')
    .select('canonical_reconciled_at, canonical_reconcile_started_at')
    .eq('id', item.reportId)
    .maybeSingle()

  const decision = decideReconcileLock(reportStatus, Date.now())
  if (decision === 'done') return 'already_done'
  if (decision === 'concurrent') return 'concurrent'

  const priorStartedAt = (reportStatus as { canonical_reconcile_started_at?: string | null } | null)
    ?.canonical_reconcile_started_at
  const locked = await acquireReconcileLock(sb, item.reportId, priorStartedAt, now)
  if (!locked) return 'lock_lost'

  try {
    const { reconcileHistoricalPvCanonicalSubjects } = await import(
      '@/lib/db/canonical-subject-historical-reconcile'
    )
    await reconcileHistoricalPvCanonicalSubjects({ runId: item.extractionRunId, siteId: item.siteId })
    await sb
      .from('site_reports')
      .update({
        canonical_reconciled_at: new Date().toISOString(),
        canonical_reconcile_error: null,
        canonical_reconcile_started_at: null,
      })
      .eq('id', item.reportId)
    return 'reconciled'
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[sweep-reconciliation] rejeu import en échec', item.reportId, ':', reason)
    await sb
      .from('site_reports')
      .update({ canonical_reconcile_error: reason, canonical_reconcile_started_at: null })
      .eq('id', item.reportId)
      .then(undefined, () => {})
    return 'failed'
  }
}

export interface ReconciliationHealth {
  /** Visites projetées et non encore canonicalisées, seuil inclus ou non. */
  pending: number
  /** Parmi elles, celles qui portent une erreur : le cas OBSERVABLE. */
  withError: number
  /** Parmi elles, celles sans erreur : le cas que ce lot élimine. */
  silent: number
  /** Âge de la plus ancienne projection non réconciliée, en heures. */
  oldestAgeHours: number | null
  lockTtlMinutes: number
  sweepThresholdMinutes: number
}

/**
 * L'observabilité minimale demandée : combien, depuis quand, avec ou sans erreur.
 * Trois nombres suffisent à savoir si l'invariant tient — inutile d'instrumenter
 * davantage tant qu'ils restent à zéro.
 */
export async function getReconciliationHealth(nowMs: number = Date.now()): Promise<ReconciliationHealth> {
  const { data, error } = await createAdminClient()
    .from('site_reports')
    .select('debrief_projected_at, canonical_reconcile_error')
    .not('debrief_projected_at', 'is', null)
    .is('canonical_reconciled_at', null)
  if (error) throw error

  const rows = (data ?? []) as Array<{ debrief_projected_at: string | null; canonical_reconcile_error: string | null }>
  const ages = rows
    .map((r) => (r.debrief_projected_at ? nowMs - Date.parse(r.debrief_projected_at) : 0))
    .sort((a, b) => b - a)

  return {
    pending: rows.length,
    withError: rows.filter((r) => r.canonical_reconcile_error).length,
    silent: rows.filter((r) => !r.canonical_reconcile_error).length,
    oldestAgeHours: ages.length > 0 ? Number((ages[0] / 3_600_000).toFixed(1)) : null,
    lockTtlMinutes: RECONCILE_LOCK_TTL_MS / 60_000,
    sweepThresholdMinutes: SWEEP_THRESHOLD_MS / 60_000,
  }
}
