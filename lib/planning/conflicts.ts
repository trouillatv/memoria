// PL3a — la DÉTECTION du conflit « site fermé, prestation prévue ». Pur, testé.
//
// Ce module ne fait QUE constater. Il ne déplace rien, n'annule rien, ne propose
// rien : PL3b posera les gestes. Ici, on répond à une seule question —
//
//     « ce jour-là, sur ce chantier, une prestation est-elle prévue alors que
//       le lieu est déclaré fermé ? »
//
// Doctrine (week-operational-signals.ts:20-24) : LECTURE SEULE, indicatif,
// jamais bloquant. Le conflit est CALCULÉ à chaque lecture, jamais persisté
// (signals/types.ts:5-8). Rien n'est écrit tant que l'humain n'a pas décidé.
//
// Le conflit ne concerne QUE des interventions déjà matérialisées : la vue
// semaine n'affiche rien d'autre. La question « occurrence projetée » ne se pose
// pas ici — elle se posera dans la vue mois.

import { findClosureForDate, type ProjectableClosure } from './closures'

/** Ce qu'une cellule de la grille sait d'une intervention (sous-ensemble de
 *  `WeekInterventionCell` — on ne dépend que du strict nécessaire). */
export interface ConflictCandidate {
  status: string
}

/** Un conflit constaté sur un (chantier, jour). */
export interface ClosureConflict {
  closure: ProjectableClosure
  /** Nombre de prestations ENCORE prévues ce jour-là (voir `isStillExpected`). */
  expectedCount: number
}

/**
 * Une prestation « encore prévue » = `planned`.
 *
 * Volontairement étroit :
 *  - `skipped`   → on a DÉJÀ dit qu'on n'y allait pas : plus rien à trancher ;
 *  - `completed` / `validated` → c'est fait, le passé ne se déplace pas ;
 *  - `in_progress` → quelqu'un est SUR PLACE : signaler « le site est fermé »
 *    serait absurde, et aucun des gestes de PL3b ne s'y applique
 *    (moveInterventionToDayAction refuse tout ce qui n'est ni planned ni skipped).
 *
 * Un conflit n'existe donc que là où une DÉCISION reste possible.
 */
export function isStillExpected(status: string): boolean {
  return status === 'planned'
}

/**
 * Croise les interventions AFFICHÉES avec les fermetures des chantiers.
 *
 * Sortie indexée `siteId → dateIso → conflit` : la même forme que `daysBySite`
 * dans `/semaine`, pour descendre dans la grille ET dans l'aperçu sans les faire
 * diverger.
 *
 * Trois silences volontaires — l'absence de conflit est l'état normal :
 *  - un site fermé SANS prestation prévue → aucun conflit (une fermeture n'est
 *    pas un problème en soi) ;
 *  - une prestation sur un site ouvert → aucun conflit ;
 *  - une fermeture retirée → elle n'arrive jamais ici (la couche DB filtre
 *    `deleted_at`), donc aucun conflit.
 *
 * Déterministe en cas de chevauchement : `findClosureForDate` applique la règle
 * fixée en PL2 (commencée le plus tôt → la plus contraignante → le plus petit id).
 */
export function detectClosureConflicts<C extends ConflictCandidate>(params: {
  /** Les lignes de la grille : un chantier, ses 7 jours, leurs interventions. */
  rows: Array<{ site_id: string; days: Record<string, C[]> }>
  /** Fermetures ACTIVES par chantier (les retirées sont déjà exclues). */
  closuresBySite: Record<string, ProjectableClosure[]>
}): Record<string, Record<string, ClosureConflict>> {
  const out: Record<string, Record<string, ClosureConflict>> = {}

  for (const row of params.rows) {
    const closures = params.closuresBySite[row.site_id]
    if (!closures || closures.length === 0) continue

    for (const [dateIso, cells] of Object.entries(row.days)) {
      const expectedCount = cells.filter((c) => isStillExpected(c.status)).length
      if (expectedCount === 0) continue // fermé mais rien de prévu : pas un conflit

      const closure = findClosureForDate(closures, dateIso)
      if (!closure) continue // ouvert ce jour-là

      if (!out[row.site_id]) out[row.site_id] = {}
      out[row.site_id][dateIso] = { closure, expectedCount }
    }
  }

  return out
}
