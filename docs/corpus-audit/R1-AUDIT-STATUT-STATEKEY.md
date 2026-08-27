# R-1 pré-migration — Audit READ-ONLY du statut au niveau `state_key`

Date : 2026-08-28. Aucun write. Prérequis à la migration additive du tri-state sur
`canonical_subject_occurrence` (décision Vincent : colonne additive, statut déterminé **au niveau du
groupe `state_key`**, HARD STOP si non attribuable sans ambiguïté).

## 1. Comment le statut est porté aujourd'hui

`document_extraction_proposal.document_status` (texte). `documentStatusToPvState` :
- `done | cancelled | informational` → **resolved**
- `open | in_progress | planned | non_compliant | awaiting_validation` → **open**
- `null` ou inconnu → **unknown** (jamais fabriquer open/resolved depuis une absence).

Le writer historique groupe par `state_key` (= famille). Une future occurrence = un groupe. Le statut du
groupe s'obtient par `aggregatePvState` (resolved > open > unknown) **sur les seules propositions du
groupe**, pas du PV entier.

## 2. Distribution corpus (522 groupes = futures occurrences)

| tri-state du groupe | n |
|---|---|
| resolved | 201 |
| open | 26 |
| unknown | 295 (dont **295 groupes 100 % null** → unknown explicite, pas d'invention) |

Valeurs brutes : `null`×427, `done`×298, `in_progress`×33, `open`×10, `informational`×10,
`non_compliant`×6, `planned`×3, `awaiting_validation`×3. 111 groupes multi-proposition.

## 3. Contradictions intra-groupe — le blocage

**15 groupes** contiennent à la fois un statut→resolved ET un statut→open dans le **même** `state_key`.
Caractérisation :

- **100 % `knowledge_fact`.** Zéro contradiction sur `action / decision / deadline / reservation /
  observation` — les familles **actionnables** (celles qui pilotent trajectoire et stagnation)
  assignent leur statut **sans ambiguïté** au niveau `state_key`.
- **100 % OCEF Compostage**, sur des **sujets-lots** : « Terrassement et purge plateforme » (21 occ),
  « Assainissement sous plateforme » (21 occ), « Couche de forme », « Essais béton »… Chaque lot
  accumule **plusieurs faits distincts dans un même PV** (avancement zone par zone), d'où des statuts
  mélangés (`[done,done,in_progress,non_compliant,done,…]`).
- **Zéro contradiction sur Bella** (le témoin et tout le corpus Bella sont propres).

Ce n'est pas du bruit : c'est la **grossièreté du discriminateur `state_key = famille`** (limite P3
connue) qui apparaît sur l'axe statut. Pooler N faits distincts dans une occurrence `knowledge_fact`
rend impossible un statut unique honnête pour cette occurrence.

## 4. Témoin Bella (multi-états) — attribution propre

| Sujet | occurrence | tri-state | statut brut |
|---|---|---|---|
| Éclairage (cc12fce6) | knowledge_fact « réalisé » | **resolved** | done |
| Éclairage | action « à refaire » | ⚠️ **unknown** | **null** |
| Électrique (2504ad1f) | knowledge_fact « Fait » | resolved | done |
| Électrique | action « à refaire » | **open** | open |
| Cuisson (b78526f9) | knowledge_fact | resolved | done |
| Cuisson | action « à refaire » | ⚠️ **unknown** | null |

Chaque occurrence Bella reçoit **son propre** tri-state (pas d'héritage agrégé au niveau PV) → le
principe D1 tient. **Réserve de qualité de données** : les propositions « à refaire » éclairage/cuisson
que j'ai insérées au **Backfill A** portent `document_status = null` → elles tombent en `unknown` au lieu
de `open`. L'électrique (issu du composite original, statut `open`) est correct. C'est un artefact de mes
inserts, réparable (aligner « à refaire » → open), indépendant de la décision de migration.

## 5. Proposition de colonne (si GO)

- Nom : **`state_status`** (le fait est longitudinal, pas « du document »).
- `CHECK (state_status IN ('resolved','open','unknown'))`, **`NULL` réservé au legacy** non backfillé
  pendant la transition. `unknown` quand on sait explicitement qu'on ne sait pas.
- Renseigné à l'écriture par `ensureHistoricalPdfOccurrences` = `aggregatePvState` **du groupe**.

## 6. thematic_category & matérialisations (notes, pas bloquant)

- `thematic_category` : à trancher — si c'est une propriété **stable du sujet**, ne pas la répéter sur
  chaque occurrence ; si elle qualifie le **fait extrait**, alors oui. À examiner hors blocage.
- `source_page` : oui au niveau occurrence (autonomie de provenance).
- Lien matérialisations : **relation, pas attribut**. Ne pas bricoler un champ id/texte. Auditer d'abord
  comment (sujet, run) reconstruit le lien aujourd'hui et si plusieurs objets peuvent correspondre.

## 7. Verdict — HARD STOP

Le statut **n'est pas attribuable sans ambiguïté au niveau `state_key`** pour 15 occurrences
`knowledge_fact` (sujets-lots OCEF). Par la règle explicite : **HARD STOP avant migration.**

Nuance décisive pour la décision : le blocage est **confiné à `knowledge_fact`** ; Bella et **toutes les
familles actionnables** sont propres. Trois issues possibles :

- **(A) Migrer, conflit → `unknown` honnête + instrumentation.** Un groupe en vrai conflit interne stocke
  `unknown` (ne jamais affirmer resolved ni open à tort — favorise le faux négatif). Loss borné (15/522),
  visible. `knowledge_fact` ne pilote de toute façon ni stagnation ni trajectoire. R-1 avance ; le
  sous-clé sémantique `knowledge_fact` devient un lot séparé avec **preuve réelle** (ces 15 + sujets-lots).
- **(B) Sous-clé `knowledge_fact` d'abord.** Traiter la granularité (un sujet-lot avec N faits/PV) avant
  R-1 — plus lourd, retarde R-1, mais supprime la cause.
- **(C) Statut par groupe = open>resolved** (jamais masquer un fait ouvert) au lieu de resolved>open.
  Change une primitive P1-3 partagée — à ne pas faire sans mesurer les régressions.

Recommandation : **(A)**. Elle respecte « ne jamais fabriquer », borne et rend visible la perte, ne
touche aucune primitive partagée, et transforme les 15 cas en signal instrumenté pour le futur lot de
sous-clé — cohérent avec la discipline « instrumenter, attendre la preuve ».
