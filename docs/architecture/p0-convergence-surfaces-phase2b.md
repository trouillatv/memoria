# P0 Phase 2B — Convergence Suivi occurrence-first (implémentation + recette)

Fermeture de la migration de vérité longitudinale : **une seule vérité occurrence-first
(`buildSiteSubjectCells`/`getPvDelta`) traverse Aperçu → Synthèse → Chronologie → Historique PV
→ Évolution**, chaque vue projetant différemment. Pas de refonte UX. Décisions Vincent : Évolution
migrée ; Tension = T1. Voir Phase 1 `p0-convergence-surfaces-phase1.md`.

## Projection PARTAGÉE (contrat, pas UI)
`lib/documents/occurrence-population.ts` — l'exclusion des acteurs (#228) fait partie du CONTRAT DE
PROJECTION, jamais un filtre ad hoc par vue :
- `getActorCanonicalIds(siteId)` — le set d'acteurs à exclure (durableKind=actor).
- `buildOccurrenceActivityMap(siteId)` — carte d'activité occurrence-first (forme `ActivityMap`) :
  lignes = TOUS les sujets occurrence-backed NON acteurs (aucun score, aucun seuil, aucune pénalité
  d'ancienneté) ; cellules = état occurrence-first par PV ; métadonnées openActions/… re-keyées par
  canonical (`getNavigableSubjectsForSite`) — décrivent, ne décident jamais de l'existence d'une ligne.
- `lib/documents/occurrence-pv-summary.ts` `buildOccurrencePvSummary` (Phase 2A) — delta 2 PV catégorisé.

## Surfaces migrées
| Surface | Avant (legacy) | Après (occurrence-first) |
|---|---|---|
| **Synthèse** (2A, commit 8bde66f6) | `getCanonicalDelta`+`computeDeltaSummary` (knowledge_fact exclu, aggravé/réouvert fusionnés) | `buildOccurrencePvSummary` (catégories séparées) |
| **Historique PV** | `getActivityMap` (proposals + score `daysSilent` + seuil → **grille VIDE**) | `buildOccurrenceActivityMap` |
| **Évolution** | `getActivityMap` + `computePeriodFacts` (aggravé/réouvert fusionnés → « Aucune transition ») | `buildOccurrenceActivityMap` + **reopened ≠ aggravated** |
| **Chronologie** | `getPvDelta` BRUT (acteurs comptés : 19 nouveaux) | `getPvDelta` + `getActorCanonicalIds` (acteurs exclus : 12) |
| **Tension → « Sujets opérationnels ouverts »** | libellé « Tension du chantier » | T1 : renommée, **calcul inchangé** ; dette `isOperationalConcern` (exclusion par famille pré-#228) = audit séparé, hors P0 |

`getActivityMap` legacy n'a plus de consommateur (dead code conservé, non retiré — hors périmètre).

## pvLastDelta — NON retiré (a des consommateurs)
Vincent : « supprimer *s'il est confirmé sans consommateur* ». Il EST consommé par `copilot-context.ts`
(delta copilote) et le mobile `prepare/page.tsx` (`DeltaBlock`). Donc conservé. C'est une surface legacy
résiduelle (copilot + prépa mobile affichent encore les anciens chiffres 2/3-fusionnés) → migration
séparée, hors P0.

## Recette — convergence cross-vues (READ-ONLY)
`scripts/recette-p0-final.ts` (+ recettes par surface) :

| Chantier | NOUVEAUX (Synthèse=HistPV=Chrono) | RÉOUVERTS (les 4 + Évolution) | aggravé≠réouvert | HistPV non vide |
|---|---|---|---|---|
| **BELLA** | **12 = 12 = 12** ✅ | **3 = 3 = 3 = 3** ✅ | aggr=0, reo=3 ✅ | 20 lignes ✅ |
| **OCEF** | 6 = 6 = 6 ✅ | 0 = 0 = 0 = 0 ✅ | ✅ | 81 lignes ✅ |

Évolution `appeared` mesure une **fenêtre par période** (multi-PV) — distinct du delta 2 PV, non contraint égal.

**Invariant PAR SUJET TÉMOIN (Bella, projection partagée)** :
électrique → **réouvert** ✅ · cuisson → **réouvert** ✅ · nettoyage → **réouvert** ✅ ·
séparation des flux → **non mentionné** ✅ · Portes CF → **nouveau** ✅ · réouvert=3, nouveau=12 ✅ ·
**16 acteurs dans le delta brut → 0 dans la projection produit** ✅.

## Invariant de WORKFLOW — le futur est automatique (pas seulement backfill)
Exigence Vincent : prouver que la convergence n'est pas due au seul backfill de l'historique.
**Audit READ-ONLY du chemin d'écriture** (chaîne `ingestion → extraction → canonicalisation →
canonical_subject_occurrence → projection → vues`) :

- **PV / CR importé** : `documents/[id]/extraction/[runId]/review-actions.ts` (création/matérialisation
  de la visite) → `after(runHistoricalMemoryBuildPipeline)` → `ensureHistoricalPdfOccurrences` écrit les
  `canonical_subject_occurrence` (source_kind=`historical_pdf`) **automatiquement en arrière-plan**, puis
  déclenche la similarité. **Aucun script de backfill dans ce chemin.** Commentaire code : « construction
  de la mémoire (arrière-plan garanti) ». Même chemin partagé pour le retry manuel (`retryMemoryBuildAction`).
- Toutes les surfaces Suivi lisent ces occurrences via `fetchSiteHistoricalOccurrences`
  (source_kind=`historical_pdf`) → `buildSiteSubjectCells` → projection partagée → vues. Un futur PV
  disant résolu/réouvert/aggravé/non-mentionné fait donc évoluer les vues **sans relancer P0-2B ni backfill**.
- **Les backfills réalisés** (P3 Backfill A, R-1) n'ont servi qu'à convertir l'historique PRÉ-pipeline ;
  ils ne sont PAS nécessaires aux nouveaux documents.

**Réserve honnête (ne pas confondre code prouvé et test exécuté)** : le chemin d'écriture est **prouvé
par le code** (automatique). Une recette end-to-end sur une donnée FRAÎCHEMENT importée (import réel d'un
nouveau PV → occurrences visibles sans backfill) n'a PAS été exécutée cette session (nécessite un nouveau
document + un run Gemini + écriture). C'est la dernière validation empirique à faire — à déclencher via
l'UI ou sur autorisation. Aucun HARD STOP : le code prouve l'automatisme ; l'occurrence field_visit vue
sur Bella (« Programmer le contrôle de l'éclairage », source_kind=field_visit) confirme que le pipeline
d'occurrences tourne hors backfill.

## Vérifications
tsc `--noEmit` PASS · recettes cross-vues PASS (Bella/OCEF) · surfaces Suivi migrées.
Ne touche pas #229/#230/#231/#233, fiches sujet, scoring Attention, extraction/canonicalisation, ni P1.
Suite : lot navigation (Histoire→Suivi + header persistant), puis P1 « David en 30 s ».
