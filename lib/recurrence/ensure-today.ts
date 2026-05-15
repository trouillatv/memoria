// Phase 6 — Récurrence simple — Slice 6.3
//
// Helper "ensureTodayInterventions" : orchestre la génération paresseuse au
// chargement des pages d'interventions (mobile agent /m, dashboard /missions).
//
// Doctrine impérative :
//   - Génération invisible : pas de loader UX, pas de message explicite. C'est
//     de la plomberie qui doit être complète AVANT que la page liste ses
//     interventions, sinon le first paint serait incomplet.
//   - Cap dur 7 jours d'avance (re-clamp ici en plus du cap du helper Slice 6.1).
//   - Idempotente : multi-tabs, refresh, navigation latérale — aucun risque
//     de doublon (UNIQUE constraint + pré-filtrage côté Slice 6.1).
//   - Silencieuse : try/catch pour ne JAMAIS casser le rendu d'une page. En
//     cas d'échec, on retourne des compteurs à zéro + console.error pour
//     traçabilité.
//   - Aucune assignation d'agent ni concept ERP (cf. doctrine planning).

import { generateInterventionsFromTemplates } from '@/lib/db/intervention-templates'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

export interface EnsureTodayParams {
  siteId?: string // scope un site précis (ex. agent rattaché à un site)
  missionId?: string // scope une mission précise
  templateIds?: string[] // scope explicite (ex. superviseur tenant-wide)
  daysAhead?: number // default 1 (today only); cap dur 7
}

export interface EnsureTodayResult {
  generated: number
  skipped: number
  templatesProcessed: number
  durationMs: number
}

const MAX_DAYS_AHEAD = 7

/**
 * Génère paresseusement les interventions récurrentes des prochains jours
 * (default = aujourd'hui uniquement). Idempotent via UNIQUE constraint.
 *
 * Au moins un scope est requis (siteId, missionId ou templateIds) — le helper
 * Slice 6.1 en dépend pour ne pas générer à l'aveugle.
 *
 * Silencieux : ne throw JAMAIS — en cas d'échec, log via console.error et
 * retourne des compteurs à zéro pour que la page continue son rendu normal.
 */
export async function ensureTodayInterventions(
  params: EnsureTodayParams
): Promise<EnsureTodayResult> {
  const start = Date.now()
  const rawDays = params.daysAhead ?? 1
  const daysAhead = Math.min(Math.max(rawDays, 1), MAX_DAYS_AHEAD)

  // Calcul des bornes [today, today + daysAhead - 1] en zone Nouméa.
  // daysAhead=1 → fromDate === toDate === today.
  const fromDate = todayLocalIso()
  const toDate = addDaysLocal(fromDate, daysAhead - 1)

  // Si aucun scope fourni, on rentre dans la branche silencieuse — le helper
  // Slice 6.1 throw sinon, et on ne veut pas casser le rendu.
  const hasScope =
    !!params.siteId ||
    !!params.missionId ||
    (params.templateIds !== undefined && params.templateIds.length > 0)
  if (!hasScope) {
    return {
      generated: 0,
      skipped: 0,
      templatesProcessed: 0,
      durationMs: Date.now() - start,
    }
  }

  try {
    const result = await generateInterventionsFromTemplates({
      fromDate,
      toDate,
      siteId: params.siteId,
      missionId: params.missionId,
      templateIds: params.templateIds,
    })
    return {
      generated: result.generated,
      skipped: result.skipped,
      templatesProcessed: result.templatesProcessed,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    // Silencieux mais traçable. Ne casse PAS le rendu de la page.
    console.error('[ensureTodayInterventions] generation failed', err)
    return {
      generated: 0,
      skipped: 0,
      templatesProcessed: 0,
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Variante "bulk" : appelle ensureTodayInterventions pour plusieurs sites.
 * Utile pour /m/page.tsx quand un chef_equipe est rattaché à plusieurs sites.
 * Erreurs par site silencieuses (chaque site est isolé).
 */
export async function ensureTodayInterventionsForSites(
  siteIds: string[],
  daysAhead = 1
): Promise<EnsureTodayResult> {
  const start = Date.now()
  if (!siteIds || siteIds.length === 0) {
    return { generated: 0, skipped: 0, templatesProcessed: 0, durationMs: 0 }
  }

  let generated = 0
  let skipped = 0
  let templatesProcessed = 0
  for (const siteId of siteIds) {
    const r = await ensureTodayInterventions({ siteId, daysAhead })
    generated += r.generated
    skipped += r.skipped
    templatesProcessed += r.templatesProcessed
  }
  return {
    generated,
    skipped,
    templatesProcessed,
    durationMs: Date.now() - start,
  }
}
