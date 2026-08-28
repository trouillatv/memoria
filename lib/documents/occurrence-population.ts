import 'server-only'

// P0 Phase 2B — PROJECTION PARTAGÉE « population produit affichable » depuis la vérité
// occurrence-first. CONTRAT DE PROJECTION (Vincent) : `getPvDelta`/`buildSiteSubjectCells`
// = delta BRUT des occurrences ; l'exclusion des acteurs (#228) fait partie de la PROJECTION,
// pas de l'UI. Toutes les surfaces de suivi (Historique PV, Évolution, et l'exclusion pour
// Chronologie) dérivent d'ICI — jamais un filtre acteur ad hoc recopié par vue.
//
// Remplace le legacy `getActivityMap` (proposals + document_status + score éditorial + seuil
// `daysSilent` → grille VIDE pour un chantier ancien alors que les occurrences existent).
// Ici : un sujet apparaît PARCE QU'IL A DES OCCURRENCES, sans score, sans seuil, sans pénalité
// d'ancienneté. `knowledge_fact` JAMAIS exclu ; seuls les acteurs (durableKind=actor) le sont.

import { buildSiteSubjectCells, type SiteSubjectCellsRow } from './site-occurrence-timeline'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { ActivityMap, ActivityCellState } from './site-synthesis'

type Cell = NonNullable<SiteSubjectCellsRow['cells'][number]>

/** Mappe une cellule occurrence-first → état de carte d'activité (présence × PV). */
function cellToActivityState(cell: Cell | null, isFirstAppearance: boolean): ActivityCellState {
  if (!cell || cell.isGap) return 'absent'          // avant 1re apparition OU non mentionné à ce PV
  if (isFirstAppearance) return 'first'
  if (cell.transition === 'réouvert') return 'reopened'
  const st = cell.observedTriState ?? cell.currentProvenState
  return st === 'resolved' ? 'done' : 'open'
}

/** Set des canonical acteurs (#228) — l'exclusion de projection partagée. */
export async function getActorCanonicalIds(siteId: string): Promise<Set<string>> {
  const navs = await getNavigableSubjectsForSite(siteId).catch(() => [])
  return new Set(navs.filter((n) => n.durableKind === 'actor').map((n) => n.canonicalSubjectId))
}

/**
 * Carte d'activité OCCURRENCE-FIRST (même forme que l'ancien `getActivityMap`, consommée par
 * Historique PV & Évolution). Lignes = TOUS les sujets occurrence-backed NON acteurs (aucun
 * seuil, aucun top-N masquant). Cellules = état occurrence-first par PV. Métadonnées d'objets
 * (openActions/…) re-keyées par canonical via `getNavigableSubjectsForSite` — elles décrivent,
 * elles ne décident JAMAIS de l'existence d'une ligne.
 */
export async function buildOccurrenceActivityMap(siteId: string): Promise<ActivityMap> {
  const [view, navs] = await Promise.all([
    buildSiteSubjectCells(siteId).catch(() => null),
    getNavigableSubjectsForSite(siteId).catch(() => []),
  ])
  if (!view || view.runs.length === 0) return { runs: [], rows: [] }

  const runs = view.runs.map((r, i) => ({ id: r.id, effectiveDate: r.effectiveDate, pvNumber: i + 1 }))
  const navByCs = new Map(navs.map((n) => [n.canonicalSubjectId, n]))
  const actorCs = new Set(navs.filter((n) => n.durableKind === 'actor').map((n) => n.canonicalSubjectId))

  const rows = view.rows
    .filter((r) => !actorCs.has(r.canonicalSubjectId)) // acteurs exclus (#228) — projection partagée
    .map((r) => {
      const firstReal = r.cells.findIndex((c) => c && !c.isGap)
      const cells = r.cells.map((c, idx) => ({ state: cellToActivityState(c as Cell | null, idx === firstReal) }))
      const nav = navByCs.get(r.canonicalSubjectId)
      const ao = nav?.activeObjects
      const hasReopen = cells.some((c) => c.state === 'reopened')
      const hasOpen = cells.some((c) => c.state === 'open' || c.state === 'reopened' || c.state === 'non_compliant')
      const realCount = r.cells.filter((c) => c && !c.isGap).length
      // Score = TRI léger uniquement (jamais un filtre) : réouverts/ouverts et objets actifs en tête.
      const score = (hasReopen ? 100 : 0) + (hasOpen ? 20 : 0) + (ao?.total ?? 0) * 5 + realCount
      return {
        canonicalSubjectId: r.canonicalSubjectId,
        label: r.label,
        score,
        openActions: ao?.actionsOpen ?? 0,
        openReserves: ao?.reservesOpen ?? 0,
        activeDeadlines: ao?.deadlinesActive ?? 0,
        overdueDeadlines: 0, // secondaire : le détail « en retard » vit dans Actions/fiche, pas ici
        hasActions: (ao?.actionsOpen ?? 0) > 0,
        hasReserves: (ao?.reservesOpen ?? 0) > 0,
        hasDecisions: (ao?.decisionsOpen ?? 0) > 0,
        hasDeadlines: (ao?.deadlinesActive ?? 0) > 0,
        cells,
      }
    })

  rows.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return { runs, rows }
}
