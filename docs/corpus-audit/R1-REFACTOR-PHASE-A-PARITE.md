# R-1 Phase A — `getCanonicalSubjectLife` sur les occurrences : rapport de parité

Date : 2026-08-28. Commit `bf68ca19`. La branche historique de la ligne de vie lit désormais
`canonical_subject_occurrence` (source longitudinale unique) au lieu de reconstruire depuis les
propositions. Aucune décision de modèle rouverte.

## Méthode de parité
Baseline capturé AVANT refactor (`scripts/r1-parity-baseline.ts`) sur Bella + corpus, comparé APRÈS
(`scripts/r1-parity-check.ts`). Doctrine : divergences ATTENDUES tolérées et comptées, divergences
INATTENDUES (invariants) = 0 exigé. **Parité aveugle refusée** : l'éclairage doit diverger, sinon R-1 a échoué.

## Résultat (corpus, 225 sujets)
- **Divergences inattendues (invariants firstSeen / lastSeen / pvCount / matérialisations) : 0.**
- Divergences attendues : currentStatus tri-state (128), ordre par position + LMCA position (12).
- **Témoin éclairage ✅** : `22/03/2024 — contrôle réalisé` (knowledge_fact/resolved, event_date) PUIS
  `05/08/2025 — à refaire` (action/open), les deux tracés au PV du 05/08/2025, désormais **séparés à l'écran**.

## Décisions de conception (dans le périmètre du modèle figé)
- **Position** longitudinale = `COALESCE(event_date, effective_date)` (ordre + LMCA). `lastSeen`/`firstSeen`
  restent fondés sur `effective_date` (date documentaire).
- **firstSeen / lastSeen / pvCount = AXE DOCUMENTAIRE** (présence = runs où le sujet a une proposition),
  pas seulement les états éligibles. Sinon un PV où le sujet est présent sans produire d'état atomique
  (observation filtrée par la garde de signification P3-B1) disparaissait de lastSeen → **régression
  corrigée** (OCEF : Débroussaillage pvCount 9→6 avant correction, restauré à 9).
- **Tri-state** depuis `state_status` ; `unknown` reste `unknown` (aucune ré-inférence texte).
- **Transitions** dérivées du tri-state (pseudo-statut done/open) → perte de `annulé`/`aggravé`/`progressé`
  (le modèle occurrence porte le tri-state, pas le statut brut). **Divergence attendue et documentée.**
- **Gaps** = runs où le sujet est absent (ni occurrence ni proposition). Présent-sans-état → pas de faux gap.
- **Matérialisations** reconstruites via `report→run` + propositions (relation existante, pas nouvelle vérité).
- **Acteurs** (person/company, sans occurrence) → **repli propositions**, comportement historique inchangé.

## Vérifications
`tsc --noEmit` OK · `tests/lib/canonical-subject-life.test.ts` 5/5 · `verify:pushable` OK · lint (2 warnings
préexistants). Affichage tri-state (state_status) câblé desktop + mobile.

## Reste (Phase B)
`getNavigableSubjectsForSite` (grille des sujets) reconstruit encore depuis les propositions → même bascule
requise pour la cohérence liste↔détail (lastSeen/stagnation/currentTriState), avec la même méthode.
