# R-1 — état d'avancement et dernière décision avant le refactor de restitution

Date : 2026-08-28.

## Livré et poussé (fondation, commit 3f502601)

- **Migration 364** : `canonical_subject_occurrence.state_status` (resolved|open|unknown, NULL legacy).
- **Primitive** `deriveOccurrenceStateStatus` : conflit interne → `unknown` (jamais masqué), missing ≠ conflict.
- **Writer** : calcule state_status au niveau du groupe state_key + logge les conflits.
- **Backfill** : 522 occurrences, 0 NULL ; 15 conflits confinés à `knowledge_fact` (sujets-lots OCEF),
  **0 conflit sur familles actionnables** ; témoin Bella éclairage/électrique/cuisson =
  réalisé→resolved + à refaire→open. Snapshot/rollback outillés. Gate `verify:pushable` OK.

L'occurrence porte donc désormais la **vérité de trajectoire** : position (`event_date`/`effective_date`),
état (`state_status`), multiplicité (`state_key`). Il ne manque plus qu'à ce que la restitution la lise.

## Audits READ-ONLY qui cadrent le refactor

- **Divergence prouvée** (R1-AUDIT-SOURCE-LONGITUDINALE) : `getCanonicalSubjectLife` reconstruit 1 primaire/run
  depuis les propositions ; témoin ❌ à l'écran alors que ✅ en base.
- **Matérialisations = RELATION (sujet, run)**, pas attribut d'occurrence : 128 matérialisations, 92 couples
  (sujet, run), dont **19 portent plusieurs objets** (1→N). → à reconstruire via `report→run` + `thread→cs`,
  jamais un champ id/texte sur l'occurrence.
- **Transitions & gaps** : dérivés (calcul), recalculables depuis occurrences + axe `canonicalRunsForSite`.

## La dernière décision (bloque la forme du refactor)

Les occurrences ne stockent pas `source_page` ni `thematic_category`, **or les deux sont affichés** par les
surfaces (fiche sujet desktop/mobile, page thread, résultat d'import pour source_page ; SubjectLifelineGrid +
thread pour thematic_category). Basculer la restitution sur les occurrences sans les porter = **régression
d'affichage**.

Nature des deux champs :
- **`source_page`** = provenance du fait (numéro de page du PV). Propre au fait → **appartient à l'occurrence**.
- **`thematic_category`** = catégorie thématique. Probablement **stable au niveau du sujet** (un sujet
  « Éclairage » reste « électricité/sécurité ») → ne devrait pas être répété sur chaque occurrence.

Options :
- **(1) source_page sur l'occurrence (migration additive) + thematic_category dérivé au niveau sujet.**
  Recommandé : source_page est une provenance par-fait (déjà validé « oui » en principe) ; thematic_category
  reste une propriété de sujet, lue une fois, pas dupliquée. Petite migration + backfill par le même workflow.
- **(2) source_page ET thematic_category sur l'occurrence.** Plus simple à câbler mais duplique une donnée
  stable de sujet sur chaque occurrence (ce que la doctrine « ne pas répéter une propriété stable » déconseille).
- **(3) Laisser tomber les deux de la ligne de vie historique.** Rejeté : régression d'affichage visible.

## Reste du refactor (après décision)

1. Migration additive éventuelle (source_page [+ thematic_category si option 2]) + backfill workflow.
2. Réécriture de la branche historique de `getCanonicalSubjectLife` : lire `canonical_subject_occurrence`
   (historical_pdf) au lieu des propositions ; state depuis `state_status`, position depuis
   `COALESCE(event_date, effective_date)`, transitions/gaps recalculés, matérialisations via (sujet, run).
3. Tie-break déterministe des états d'un même document à date égale (famille puis label).
4. Non-régression : parité avant/après sur Bella (occurrences, transitions, gaps, LMCA, lastSeen, stagnation) +
   témoin éclairage raconté à l'écran (22/03/2024 réalisé PUIS 05/08/2025 à refaire, provenance PV 2025).

**HARD STOP** — décision (1) / (2) / (3) requise avant de porter les colonnes et réécrire le read-model.
