// P1-PERF-B — plan de chargement du Suivi (/sites/[id]/historique).
//
// Chaque clic d'onglet re-rend la page entière (force-dynamic + searchParams) : tout ce
// qui est chargé inconditionnellement est payé à CHAQUE clic. L'audit 2026-09-06 a montré
// que ce « tronc commun » était à ~90 % un faux commun (~10,6 s cumulés / 57 requêtes par
// clic, dont un delta de 2,1 s consommé par la seule Synthèse).
//
// Doctrine : le tronc payé par toutes les vues = ce que le SHELL (header + onglets)
// consomme réellement — identité, runs canoniques légers, occurrences natives (compteurs).
// Toute matière lourde est conditionnée à la vue qui l'affiche. Interdits : préchargement
// multi-vues, mini-matrice parallèle, changement d'URLs.
//
// Fonction PURE : la page la consomme, les tests la vérifient sans rendre la page.

export type SuiviViewKey = 'synthese' | 'avant-apres' | 'lifelines' | 'evolution' | 'deps' | 'attention'

export interface SuiviLoadPlan {
  /** Matrice sujet × PV complète (rows) — la plus chère (~4 s / 8 req sur RUS). */
  matrix: boolean
  /** Timeline historique (snapshots) — sert la Synthèse ; le compte du header vient des runs. */
  timeline: boolean
  /** Sujets importants (importanceScore) — Synthèse + tri de Lignes de vie. */
  importantSubjects: boolean
  /** Delta des 2 derniers PV (buildOccurrencePvSummary, 18 req) — affiché par la Synthèse SEULE. */
  deltaSummary: boolean
  /** Labels canoniques ciblés (1 requête batchée) pour les vues rendues SANS matrice. */
  canonicalLabels: boolean
}

export function suiviLoadPlan(view: SuiviViewKey): SuiviLoadPlan {
  return {
    matrix:            view === 'synthese' || view === 'lifelines',
    timeline:          view === 'synthese',
    importantSubjects: view === 'synthese' || view === 'lifelines',
    deltaSummary:      view === 'synthese',
    canonicalLabels:   view === 'lifelines' || view === 'evolution',
  }
}
