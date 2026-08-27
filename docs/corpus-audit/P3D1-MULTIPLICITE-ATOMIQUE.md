# P3-D1 — Multiplicité atomique des occurrences (cible B, sans event_date)

Date : 2026-08-28. Suite de P3-C. Cible : `canonical_subject_occurrence` représente un **état/événement
atomique daté** d'un sujet durable, plus « le sujet apparaît dans ce rapport ». D1 = multiplicité +
dédup same-state. **Pas d'`event_date` (D2), pas de backfill massif (lot A).** Livraison en 10 points.

## 1. Schéma cible exact

`canonical_subject_occurrence` gagne une colonne **`state_key text`** (mig 362). Clé d'unicité du canal
historique **affinée** : `cso_historical_pdf_uniq (canonical_subject_id, source_ref_id, state_key)
NULLS NOT DISTINCT WHERE source_kind='historical_pdf'`. On **affine**, on ne supprime jamais la
contrainte. Legacy : `state_key = NULL` (une seule ligne null par (sujet, rapport), garantie par
NULLS NOT DISTINCT — identique à l'ancienne contrainte). Additif, sûr pour l'existant, **aucun
backfill dans D1**.

## 2. Stratégie de dédup same-state (le cœur)

`lib/db/occurrence-state-key.ts` (pur, testé) :
- `deriveStateKey(family)` = discriminateur d'état déterministe. **D1 : un état = une `proposal_family`.**
- `groupPropositionsByState(props)` : regroupe les propositions d'un (sujet, rapport) par état. Un
  groupe = une occurrence. **Plusieurs états distincts → plusieurs occurrences ; plusieurs
  reformulations/preuves du MÊME état (même famille) → UNE occurrence.**

Preuve corpus (P3-C) : les 12 cas multi-état réels sont **cross-family** (knowledge_fact « contrôlé/
réalisé » = état constaté ; action/observation « à faire/à refaire » = tâche/signal ; decision/deadline/
reservation = leurs états), les 73 reformulations sont **same-family**. Grouper par famille sépare donc
les vrais états et dédoublonne les reformulations. **NE PAS confondre avec « 1 proposition = 1
occurrence »** (faux dans 73/85 cas).

## 3. Identité / idempotence

Identité d'une occurrence = **(canonical_subject_id, source_ref_id, state_key)**. Rejouer 10× le même
PV → mêmes familles → mêmes `state_key` → `ON CONFLICT DO NOTHING` → **aucun doublon**. Le
`ensureHistoricalPdfOccurrences` groupe par `${csId}::${stateKey}`, insère une occurrence par état, et
la relecture après conflit filtre aussi sur `state_key`.

## 4. Impact consumers

- **`canonical-subject-life.ts` (LMCA/lastSeen/stagnation)** : la timeline pouvait fabriquer un
  changement intra-document et dépendre de l'ordre des ex-æquo (multi-occurrences même `effective_date`).
  Fix : **`collapseLmcaOccurrencesByDate`** (pur, testé) effondre par date **avant** `computeLmca…`
  (agrégation `resolved>open>unknown`, commutative). **NO-OP** pour les données mono-occurrence
  existantes → **zéro régression** ; reproduit la sémantique de l'ancien modèle poolé. La distinction
  temporelle réalisé→à refaire est renvoyée à **D2** (event_date).
- **lastSeenAt / firstSeenAt** : inchangés (dernière/première date) — insensibles à la multiplicité.
- **Lignes de vie / Chronologie / Histoire** : afficheront N états/document (c'est le but) ; ordre
  d'affichage à stabiliser cosmétiquement (tri secondaire), non bloquant.
- **actor links** : posés par occurrence (inchangé) — chaque état atomique porte ses propres liens.
- **semantic suggestions / canonicalisation** : lisent des sujets, pas des occurrences → inchangés.

## 5. Tests

- `occurrence-state-key.test.ts` (9) : 3 témoins Bella cross-family → N ; reformulations same-family → 1 ;
  mélange dédup+distinct.
- `subject-state-collapse.test.ts` (6) : NO-OP mono-occurrence ; effondrement même-jour déterministe ;
  union sig ; témoin éclairage sans faux changement.
- Non-régression : `occurrence-eligibility` (7), `canonical-occurrence-invariant` + `occurrence-identity`
  (13) verts. Typecheck 0.

## 6. Dry-run Bella (SIMULATION, aucune écriture)

`scripts/dryrun-p3d1-multiplicity.ts` rejoue le groupement D1 sur les propositions réelles (sans lancer
le workflow, qui dupliquerait legacy+atomique sur un corpus déjà importé) :

```
Propositions éligibles : 33
Occurrences AVANT (1 par (sujet, rapport)) : 25
Occurrences APRÈS (1 par état, D1)          : 32   (+7)
Sujets multi-état : 7
```
Multi-état = extincteurs (kf+obs), nettoyage (kf+obs ; + deadline+action), cuisson (kf+obs), système
extinction (kf+obs), dégagement Mall (kf+decision), séparation flux (**action + observation×2 dédupées
en 1**). **Dédup same-state prouvée** (observation×2 → 1 état).

## 7. Impact corpus (519 couples)

P3-C : 85/519 (16,4 %) multi-proposition ; 73 same-family (**restent 1** — dédup) ; 12 mixtes
(**deviennent N**). Ordre de grandeur du delta au backfill : **~+12 occurrences** sur le corpus
disponible (croissant avec B2/Géant).

## 8. Plan de migration / backfill (NON exécuté en D1)

- **Migration** (mig 362) : appliquée (colonne + index affiné). Sûre, additive.
- **Workflow futur (B)** : `ensureHistoricalPdfOccurrences` réécrit → tout **nouvel** import (CR 2026)
  produit directement la représentation atomique.
- **Backfill historique (A)** : lot séparé, après GO. Re-dériver les occurrences depuis les propositions
  avec `state_key` ; les 12 groupes mixtes → N occurrences ; **écraser les lignes legacy (state_key=NULL)
  par les lignes atomiques** (delete legacy + insert atomiques, ou update). ⚠️ Le témoin éclairage
  nécessite d'abord l'atomisation B2 du composite (la proposition « éclairage à refaire » n'existe pas
  encore dans les données historiques). Dry-run de comptage obligatoire avant.

## 9. Rollback

- Migration : `DROP INDEX cso_historical_pdf_uniq` + recréer l'ancien `(canonical_subject_id,
  source_ref_id)` + `ALTER TABLE … DROP COLUMN state_key`. Réversible (aucune donnée legacy modifiée).
- Workflow : revert du commit. Les occurrences legacy restent valides (state_key=NULL).

## 10. Limites connues

- **Même-famille multi-état** (ex. deux knowledge_fact « réalisé 2022 » + « à refaire ») dans un même
  rapport → poolées par D1 (famille trop grossière). **Non observé dans le corpus** ; à raffiner via
  statut/polarité ultérieurement. D1 favorise la dédup (sous-split), symétrique du « faux négatif ».
- **Date événementielle interne** (réalisé 22/03/2024 vs PV 05/08/2025) : **non traitée** = D2.
- **Backfill Bella / éclairage** : bloqué tant que la proposition « éclairage à refaire » n'existe pas
  (composite non atomisé côté données) — dépend de A + B2.

## État de livraison

**CODÉ / COMPILÉ / TESTÉ / MIGRÉ (mig 362 appliquée) — dry-run simulé, AUCUN backfill.** Le workflow futur
est atomique ; l'existant est inchangé (legacy en NULL) jusqu'au backfill A gaté.

**HARD STOP.** Ne pas lancer l'audit UI ni le backfill A. Reste : ton GO pour **P3-D2** (event_date) puis
**A** (backfill Bella/corpus, avec dry-run de comptage), avant l'audit écran.
