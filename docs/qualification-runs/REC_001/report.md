# Rapport de qualification — REC_001

Document : *PV de réception provisoire / opérations préalables à la réception (OPR)* — réhabilitation de la maison des jeunes Zerktouni (5 pages, marché n°281/2021/MJS-PACA-MJZ-TRAV, titulaire COS CONSTRUCTION SARL, maître d'ouvrage Casablanca Aménagement). Formulaire administratif type avec cases à cocher (épreuves, travaux, ouvrages, installations, terrains) suivi d'une Annexe I listant 13 réserves individuelles.

- Référence (Phase A) : 33 éléments, 0 photo.
- MemorIA (Phase B, pipeline de production réel) : 32 propositions.

## Constat global

25/33 éléments de référence MATCHED, 0 PARTIAL, 5 MISCLASSIFIED (famille `observation` entièrement absente côté MemorIA), 3 MISSED. Recall global strict (matched/total) = **25/33 = 76 %**.

Le cœur métier du document — l'Annexe I des 13 réserves individuelles (famille `reservation`) — est retrouvé avec un recall et une précision quasi parfaits : 13/13 réserves capturées mot pour mot, localisation et responsable (COS CONSTRUCTION SARL) correctement attribués, aucune réserve omise ni date de levée fabriquée. Les défauts se concentrent ailleurs : la famille `observation` (5 constats à case à cocher) est totalement absente de la sortie MemorIA, et deux de ces constats sont non seulement mal classés mais **factuellement inversés** par rapport à la case réellement cochée sur le PDF source — l'anomalie la plus grave relevée sur ce document.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Missed | Misclassified | Recall | Précision |
|---|---|---|---|---|---|---|
| person | 5 | 5 | 0 | 0 | **100 %** | **100 %** |
| company | 4 | 3 | 1 | 0 | **75 %** | **100 %** (1/3 porte un champ `companyRole` fabriqué, voir ci-dessous) |
| deadline | 1 | 1 | 0 | 0 | **100 %** | **100 %** |
| decision | 1 | 0 | 1 | 0 | **0 %** | n/a — 0 proposition émise dans cette famille sur ce document |
| observation | 5 | 0 | 0 | 5 | **0 %** | n/a — 0 proposition émise dans cette famille sur ce document |
| knowledge_fact | 4 | 3 | 1 | 0 | **75 %** | **50 %** (3 vrai positif, 1 faux positif — contenu inversé, 2 misclassified reçus depuis `observation`) |
| reservation | 13 | 13 | 0 | 0 | **100 %** | **86,7 %** (13 vrai positif, 1 faux positif — contenu inversé, 1 misclassified reçu depuis `observation`) |
| action | 0 | — | — | — | n/a — 0 élément de référence | n/a — 0 proposition |

## Biais systématiques identifiés

**1. Inversion de case à cocher vérifiée sur le PDF source (page 2, points 4 et 5) — finding critique.** Sur les 5 items à cases à cocher (épreuves, travaux, ouvrages, installations, terrains), 3 sont lus correctement (épreuves E12, travaux E13, ouvrages) et 2 sont inversés : la case réellement cochée est « ■ ont été repliées » (installations de chantier) mais MemorIA produit « Installations de chantier non repliées » (E15) ; la case réellement cochée est « ■ ont été remis en état » (terrains et lieux) mais MemorIA produit « Terrains et lieux non remis en état » (E16) — l'exact opposé dans les deux cas. E16 va plus loin en classant ce contenu inversé en famille `reservation`, fabriquant ainsi une 14ᵉ réserve inexistante à côté des 13 réserves réelles de l'Annexe I, par ailleurs toutes parfaitement capturées. Ce n'est pas une simple erreur de classification (comme E12/E13/E14 ci-dessous) mais une fabrication de contenu contredisant la source : les deux sont comptées comme `falsePositive` (et non simple `misclassifiedFromOtherFamily`) dans `precisionByFamily`. Le moteur n'est donc pas fiable de façon uniforme sur la lecture des cases cochées de ce type de formulaire.

**2. Famille `observation` totalement absente (5 cas).** Les 5 constats à case à cocher de la page 1-2 (épreuves E12, travaux E13, malfaçons E14, installations E15, terrains E16) sont tous rangés ailleurs par MemorIA : 3 en `knowledge_fact` (E12, E13, E15), 2 en `reservation` (E14, E16). Contenu fidèle pour 3 d'entre eux (épreuves, travaux, malfaçons — famille erronée, contenu correct) et inversé pour 2 (installations, terrains — cf. finding critique). Aucune proposition MemorIA n'utilise la famille `observation` sur ce document.

**3. Conflation de deux entités société sur la maîtrise d'œuvre.** La proposition `company` pour « Centrale Polytechnique Africaine » (E08, rôle non précisé par le texte source — ambiguïté déjà signalée par la référence) reçoit `companyRole="maître d'œuvre"` et `description="Maîtrise d'œuvre du projet"` — un libellé emprunté mot pour mot à la page de signatures, où c'est en réalité une **autre** entité nommée, « Maitrise d'Œuvre Ingénierie », qui porte ce rôle et qui a dressé le PV. Cette dernière (E09) n'a aucune fiche société propre côté MemorIA : perte nette d'une entité réelle, masquée par une fabrication de rôle sur une entité différente.

**4. Décision administrative manquée.** La case « ■ Réception provisoire du marché » (vs. « □ Réception provisoire partielle » non cochée) n'est couverte par aucune proposition MemorIA, quelle que soit la famille — la famille `decision` compte 0 proposition sur ce document alors que la référence en identifie 1 (E11).

**5. Champ vierge non signalé.** Le champ « Accepté par le titulaire en date du : …… » laissé vierge page 3 (E20) n'est signalé par aucune proposition MemorIA : l'information que l'acceptation formelle du titulaire est encore en attente n'est pas capturée.

## Doublons internes à MemorIA

Aucun doublon détecté (`duplicateProposalsWithinMemoria` absent de comparison.json).

## Section Photos

Référence Phase A : 0 photo (le document est un formulaire scanné pur ; chaque page comporte un rendu visuel du formulaire lui-même mais aucune photographie factuelle de désordre). MemorIA a extrait **5** evidence `image` (une par page), toutes avec le même bbox exact (89.28,736.56,465.36,840.24) et les mêmes dimensions natives (376x103px) — très probablement un bandeau/logo d'en-tête répété identiquement sur chaque page, pas un contenu photographique réel. 2 des 5 portent une légende tronquée et non descriptive (« Auc » page 2, « L' » page 5 — même biais de légendes tronquées que documenté sur VRD_002). Aucune des 5 evidence image n'est liée à une proposition via `proposalEvidenceLinks` (0 lien image sur 15 liens, tous vers du `text_excerpt`) : aucune réserve ne prétend s'appuyer sur une photo de désordre inexistante. Conforme à l'attendu de la référence — pas de perte de contenu réelle sur cette dimension malgré les 5 evidence image superflues et non pertinentes.

## Éléments manqués

3 éléments MISSED sur 33 :

| Élément | Famille | Contenu |
|---|---|---|
| E09 | company | « Maitrise d'Œuvre Ingénierie », entité explicitement nommée page 3 comme rédactrice du PV — absorbée par la fiche E08 (voir biais n°3). |
| E11 | decision | Case cochée « ■ Réception provisoire du marché » — aucune proposition, famille `decision` à 0 sur ce document. |
| E20 | knowledge_fact | Champ « Accepté par le titulaire en date du : …… » laissé vierge — acceptation formelle en attente non signalée. |

## Synthèse

Sur REC_001, le moteur excelle sur son périmètre le plus dense (13/13 réserves de l'Annexe I, recall et précision quasi parfaits) mais échoue de façon uniforme sur la famille `observation`, jamais déclenchée, avec deux conséquences distinctes : une dispersion sans perte de contenu (3 cas) et une **inversion factuelle de case à cocher** vérifiée sur le PDF source pour 2 cas (installations, terrains), dont un fabrique une 14ᵉ réserve inexistante. S'y ajoutent une conflation de deux entités société sur la maîtrise d'œuvre et deux pertes ponctuelles (décision de réception, champ d'acceptation vierge). Le point le plus actionnable est l'inversion de case à cocher : contrairement aux autres biais du corpus (classification, granularité, légendes), celui-ci produit un contenu contraire à la source, pas seulement mal rangé.
