// Configuration centralisée du moteur de suggestion de relations inter-sujets.
//
// Ces paramètres ont été calibrés sur deux échantillons indépendants (top 1–20 et 21–40 Pool B)
// sur le chantier OCEF Compostage (9 PVs, 2026-08-08). Ne pas modifier sans recalibration
// sur un corpus plus large (≥ 30 chantiers).

export const RELATION_CANDIDATE_CONFIG = {
  // Signal statistique minimum pour former un candidat
  minCooccurrences: 3,        // nombre de runs partagés
  minLift: 1.5,               // facteur de surprise vs hasard

  // Contrôle du volume LLM par run
  maxCandidatesPerRun: 10,    // maximum de paires soumises à Gemini

  // Seuil de confiance LLM pour écriture suggested
  minLlmConfidence: 0.70,

  // Invariant acteur : person/company ne participent pas au générateur statistique.
  // Les relations acteur ↔ sujet passent par le modèle acteur existant
  // (assigned_company_id, responsible_company_id, tryActorAutoLink, etc.)
  excludedFamilies: ['person', 'company'] as string[],

  // Paires knowledge_fact ↔ knowledge_fact exclues du pipeline principal V1 (bruit documentaire)
  excludeKfKfPairs: true,
} as const
