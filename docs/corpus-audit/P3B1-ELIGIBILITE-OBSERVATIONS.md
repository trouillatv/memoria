# P3-B1 — Éligibilité des observations à la mémoire longitudinale (B / workflow futur)

Date : 2026-08-27. Suite du diagnostic [P3-A](./P3A-DIAGNOSTIC-ELIGIBILITE-MEMOIRE.md). Corrige le
**défaut moteur #1** : les observations n'obtenaient jamais d'occurrence → certains états datés
significatifs (Registre non renseigné, Largeur réduite) restaient invisibles en ligne de vie.

## Cause (rappel P3-A)

`ensureHistoricalPdfOccurrences.ELIGIBLE_FAMILIES` filtrait sur `proposal_family` mais listait des
noms de **kind** (`vigilance`, `reservation`) au lieu de la famille réelle `observation`. Bug de
nommage, pas décision métier : les observations étaient exclues des occurrences.

## Correction — du contenant au contenu (pas de whitelist)

Doctrine P3-A §8 : *une occurrence représente un état/événement daté SIGNIFICATIF d'un sujet durable,
pas un type de proposition.* Implémentation minimale, sans nouveau moteur ni LLM :

- **`isProposalOccurrenceEligible(family, label, description)`** (pur, exporté, testé) :
  - familles à état (action/decision/knowledge_fact/deadline…) → éligibles **par nature** ;
  - `observation` → éligible **si le texte est significatif**, via le garde générique **déjà utilisé
    pour les relations** (`selectBestText` / `isInformativeText`) : rejette le transitoire/éphémère
    (« à voir », « demain », < 15 car.), garde l'état daté substantiel.
- Gate `ensureHistoricalPdfOccurrences` : requête élargie à `observation`, filtrée par le prédicat,
  **instrumentée** (`[historical-occ] observations éligibles k/n`) pour rendre visible un afflux type
  Géant.

**Réutilise une primitive existante** (aucune couche supplémentaire) — répond aux réserves « trop de
couches » et « coût ».

## Limite connue (assumée + instrumentée)

`isInformativeText` est un garde **longueur/temporel**, pas sémantique : une observation
**substantielle mais transitoire** (« Il pleuvait ce jour ») passerait. Résidu documenté par un
test-témoin explicite ; traité **seulement si le terrain le montre** (le compteur d'instrumentation
le révélerait). On ne rajoute pas de juge LLM par prudence de coût/complexité.

## Vérifications

| Vérification | Résultat |
|---|---|
| Tests unitaires du prédicat | **PASS** — 7 (Registre/Largeur éligibles ; transitoire rejeté ; description utilisée ; témoin de la limite) |
| Typecheck / Lint | **PASS** — 0 / 0 |
| Dry-run Bella (READ-ONLY, aucune écriture) | voir ci-dessous |

### Dry-run Bella (8 observations)

**8/8 éligibles · 2 NOUVELLES occurrences · 6 poolées · 0 rejet** — conforme à la prédiction P3-A :

- 🆕 **Registre de sécurité non renseigné** (2024) → occurrence créée (sujet rendu visible) ;
- 🆕 **Largeur de passage des dégagements réduite** (2025) → occurrence créée (sujet rendu visible) ;
- 6 autres → **poolées** dans une occurrence existante (evidence_count++), aucun doublon d'occurrence ;
- **0 rejet** : le corpus Bella est entièrement significatif (aucun transitoire).

## Portée & limites du lot

- **B1 = workflow futur uniquement.** Le gate change le comportement des **prochains imports** (dont
  CR 2026). Il **ne recrée PAS rétroactivement** les 2 occurrences manquantes de Bella — c'est **A**
  (backfill), lot séparé (snapshot/rollback), **non fait ici**.
- **B2 (fait multi-sujets / composite électrique-éclairage-cuisson)** = défaut moteur #2, **distinct**,
  non traité ici (ne pas mélanger éligibilité et composite — P3-A §10).
- **Défaut #3 (une occurrence par (CS, rapport))** : hors P3, non traité.

---

# P3-A — Backfill Bella exécuté (via le mécanisme P3-B1)

`scripts/backfill-p3a-bella.ts --apply` : rejoue `ensureHistoricalPdfOccurrences` sur les 2 runs Bella
(le MÊME chemin que les futurs imports, aucun INSERT spécifique). Snapshot → run → vérif → rollback auto.

```
run 2024-07-19 → created=1 skipped=7   (Registre de sécurité … non renseigné)
run 2025-08-05 → created=1 skipped=16  (Largeur de passage … réduite)
```

Invariants vérifiés (tous ✅) :
- **2 nouvelles occurrences** exactement — Registre (2024-07-19) + Largeur (2025-08-05) ; provenance
  `historical_pdf`, `source_ref_id` = bon rapport, `kind=business_subject`.
- **1 occurrence par cible** ; total site **24 → 26** (les 6 observations déjà couvertes → `skipped`,
  aucune surnuméraire, aucun doublon).
- **0 nouveau lien acteur** (aucune absorption acteur).
- **3 → 3 suggestions** : aucun rapprochement/fusion déclenché implicitement.
- Cibles **actives / business_subject / non fusionnées**. **Largeur JAMAIS liée au « Dégagement Mall »**
  (préoccupation distincte — R2e).

Rollback disponible : le script re-supprime précisément les occurrences/liens créés si un invariant
échoue (non déclenché ici, tout est vert).

**HARD STOP.** B1 (workflow) + A (backfill Bella) livrés et vérifiés. Reste **B2** (composite), à
démarrer par un **audit READ-ONLY** (où éclater), séparé. Attend ton GO.
