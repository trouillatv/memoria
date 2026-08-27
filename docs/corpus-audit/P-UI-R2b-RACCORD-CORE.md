# P-UI-R2b — Raccord (cœur déterministe) : persistance + gate + routing UI

Date : 2026-08-27. Design retenu (Vincent) : **ne PAS falsifier `recommendation='merge'`**. Les trois
notions restent distinctes en base : `verdict` (ce que le juge conclut), `recommendation` (ce qu'il
conseille), `same_object_hypothesis` (« pourraient malgré tout être le même objet », significatif si
verdict=related). La question UX « Même sujet ? » ne falsifie pas le verdict moteur.

## Livré (cœur, sûr, testé)

- **Migration 357** : colonne additive `canonical_subject_similarity_suggestion.same_object_hypothesis`
  (bool, défaut false, réversible, pas de backfill).
- **Persistance** : `upsertSuggestion` écrit désormais `same_object_hypothesis` ; `PersistedSuggestion`
  porte le champ (lecture via `select('*')`).
- **Gate (pur, testé)** :
  - `isSameSubjectQuestion` = `recommendation==='merge' || (verdict==='related' && same_object_hypothesis)`.
  - `shouldPersistSemanticSuggestion` = `same_subject || (related && same_object_hypothesis)` — jamais
    related+false / distinct / uncertain (l'UI n'est pas la poubelle des hésitations).
- **Routing UI (sans falsifier `recommendation`)** : `memory-build-result` calcule côté serveur
  `askSameSubject = isSameSubjectQuestion(s)` et le passe à l'UI ; `ImportResultSuggestions` présente la
  carte « Même sujet ? » (Même sujet / Garder séparés) quand `askSameSubject`, sinon les boutons
  lien/incertain. Une suggestion `related + SOH=true` (recommendation=link en base) est donc présentée
  comme une question de fusion **sans** modifier sa recommandation.
- **Actions inchangées** : « Même sujet » → fusion réelle + journal (chemin existant) ; « Garder
  séparés » → rejected (mémoire des refus) ; « Plus tard » → pending. L'humain peut fusionner même si
  l'IA n'avait émis qu'une hypothèse — c'est le rôle du human-in-the-loop.

## Preuve (synthétique, déterministe)

`tests/subjects/same-object-gate.test.ts` (+ `same-object-hypothesis.test.ts`) :
- `related + SOH=true` → carte « Même sujet ? » ; `related + SOH=false` → **aucune** carte de fusion ;
  merge → carte ; none/uncertain/distinct → pas de fusion.
- Gate de persistance : same_subject / related+true → persister ; related+false / distinct / uncertain →
  ne pas persister.

Vérifications : 23 tests (gate + contrat + cycle de vie) PASS ; typecheck 0 ; lint 0.

## Ce qui reste — P-UI-R2c (le FEED, lot dédié)

Le cœur route et persiste correctement `same_object_hypothesis`, **mais la voie sémantique n'alimente
pas encore la table** : le seul générateur de candidats est lexical (Jaccard ≥ 0.2), donc les paires
lexicalement disjointes (Mall/food court, local technique/électrique) ne deviennent toujours pas des
suggestions. Le feed est un lot distinct car il porte le vrai coût/risque :
- pass LLM borné sur `touchés × actifs` non-lexicaux (cap dur, sinon skip+log) ;
- enrichissement du contexte d'occurrence transmis au juge (décisif pour le verdict) ;
- gate `shouldPersistSemanticSuggestion` à l'écriture ;
- exclusion acteurs (déjà gratuite : `loadSimilarityContextSubjects` filtre `isActorKind`) ;
- idempotence (paire normalisée A/B, unique) + mémoire des refus (`rejectedPairs`) déjà en place ;
- **dry-run du NOMBRE** de suggestions créées sur Bella Napoli avant tout branchement (attendu ~0 :
  Mall/food court déjà fusionné humainement — ce n'est pas un échec).

Le feed doit être **branché derrière un dry-run validé**, pas activé silencieusement à chaque import
(coût LLM). D'où le lot séparé.

**HARD STOP.** Cœur livré + prouvé synthétiquement. Le feed (P-UI-R2c) attend ton GO, avec son dry-run
de comptage avant activation.
