# #218 — Replay B2 READ-ONLY sur document réel OCEF (non réparé)

**Statut : audit READ-ONLY. Aucune écriture, aucune donnée modifiée.** HARD STOP.
Sonde : `scripts/p218-b2-replay-ocef.ts`.

## Objectif

Éprouver l'invariant d'atomicité de l'extracteur (contrat B2, historical-visit-extractor.ts §Atomicité) sur
un document RÉEL n'ayant fait l'objet d'AUCUNE réparation manuelle B2 (les réparations #201 étaient
Bella-only). Question de Vincent : MemorIA produit-elle spontanément le bon graphe hors du corpus Bella
longuement réparé — et surtout, **sait-elle NE PAS sur-splitter** ?

## Document

`PV 010 — OCEF Compostage — 2026-07-16` (`documents.id` 2268d6c6, 14 326 c, 34 pages). Chantier VRD /
terrassement : narratif (p.2-4) + grand tableau de planning type Gantt (p.32-33) listant ~40 travaux avec
états (Fait / à faire). Corpus volontairement HOSTILE à l'atomicité (beaucoup de sujets-lots, formulations
de tableau), donc meilleur crash-test que Bella.

Source = `documents.extracted_text` réel (pas une reconstruction depuis les excerpts). Replay via
`extractHistoricalPvProposals(text, 34)`.

## Mesures

| | valeur |
|---|---|
| Propositions métier AVANT (base, run f0d8786c) | 66 |
| Propositions métier APRÈS (replay B2) | 70 |
| Extraits source éclatés en ≥2 propositions (SPLITS) | **1** |
| Sur-splits de composants (débourbeur/déshuileur, éprouvette/carottage, busages+fonds de regard…) | **0** |
| Acteurs faussement métier | 0 |

*(Compte global INFORMATIF : LLM non déterministe ; le verdict porte sur le comportement d'atomicité, pas le total.)*

## Classification

- **OVER_SPLIT : 0.** Aucun composant isolé. Vérifié sur les pièges connus, tous **conservés en UN sujet** :
  - « Essais béton (éprouvette ou carottage) » → 1 (méthodes d'un même essai, non éclatées) ;
  - « Fiche technique débourbeur déshuileur » → 1 (équipement unique débourbeur-déshuileur) ;
  - « Mise en place des busages sous la plateforme et réalisation des fonds de regard » → 1 (travail coordonné) ;
  - « Busage provisoire GDE » / « Fossé GDE » restent des sujets distincts nommés (pas des composants d'un même objet).
- **MUST_SPLIT_AND_SPLIT : 1 (légitime).** Le seul extrait éclaté (« Couche de forme = Fait ») → 2 propositions
  « Couche de forme de la plateforme » + « Couche de forme de l'accès plateforme ». Ce sont **deux zones
  physiques distinctes** (plateforme vs accès) à trajectoires indépendantes ; l'AVANT les portait déjà séparées.
  Split conforme au contre-test (états futurs indépendants + retrouvables individuellement).
- **MUST_SPLIT_BUT_NOT_SPLIT : 0 détecté.** Aucun composite « même état sur plusieurs sujets indépendants »
  laissé groupé. Le document OCEF est naturellement atomique (chaque travail = une ligne), il ne contient pas
  de phrase composite du type « électrique + éclairage + cuisson » (piège Bella).
- **SHOULD_STAY_GROUPED_AND_GROUPED : plusieurs, confirmés** (voir OVER_SPLIT=0).
- **Cas borderline (non défaut) :** les fiches techniques par équipement (Débitmètre / Dégrilleur / débourbeur)
  apparaissent en knowledge_facts distincts — cohérent avec l'AVANT et légitime (chaque FT a une trajectoire
  de validation propre). Granularité correcte, pas un sur-split.

## B2 vs D1 (séparation demandée)

Ce replay teste l'EXTRACTION (B2) : l'extracteur produit des **sujets atomiques distincts**, sans
fragmentation de composants. Il ne teste PAS le poolage aval `state_key=family`, qui n'intervient qu'APRÈS
réconciliation (attribution d'un canonical_subject) — hors périmètre d'un replay d'extraction READ-ONLY.
Indice qualitatif : les occurrences d'un même sujet à états/dates différents et familles différentes (ex.
« Essais plateforme 20.02 non conformes » [reservation] vs « Essais plateforme 30/03 conformes »
[knowledge_fact]) sont produites séparément — c'est la trajectoire longitudinale voulue, pas une conflation.
Aucun signal de défaut D1 visible à l'extraction. Un test D1 dédié nécessiterait de rejouer la réconciliation.

## Verdict

**B2 tient hors Bella.** Sur un document OCEF riche et hostile à l'atomicité (34 pages, grand tableau de
planning), l'extracteur produit 70 propositions atomiques **sans sur-splitter** : 0 composant fragmenté, 1
seul split et il est légitime (deux zones distinctes). Le point le plus surveillé — *savoir ne pas splitter* —
est **confirmé**. Aucune anomalie → pas de HARD STOP correctif.

## Prochaine étape proposée (NON démarrée)

Le workflow d'extraction est prouvé transverse sur Bella + OCEF. Prochaine étape naturelle : soit un second
replay sur un document PETRO (autre nature documentaire, pour élargir la preuve), soit reprendre la trajectoire
produit (exploitation de la vérité longitudinale désormais fiable). À décider par Vincent. HARD STOP.
