# AUT_004 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : Rapport Initial de Contrôle Technique (RICT) — aménagement des combles en bureaux et installation de la climatisation, Mairie de Coupvray. Rédacteur : BTP Consultants (bureau de contrôle technique), 14 pages.
**Référence (Phase A)** : 24 éléments, extraits indépendamment du PDF source.
**MemorIA (Phase B)** : 34 propositions — sortie pipeline réelle, non modifiée.

## Constat global

Sur les 24 éléments de référence : **9 MATCHED**, **1 PARTIAL**, **7 MISSED**, **7 MISCLASSIFIED**. Aucune des 34 propositions MemorIA n'est un faux positif ou un extra étranger au document (0 legitimateExtra, 0 faux positif) : tout le contenu produit correspond à un passage réel et vérifiable du rapport.

- **recallStrict = 37,5 %** (9/24, bonne famille + contenu complet).
- **recallContentFound = 70,83 %** (17/24, contenu retrouvé quelle que soit la famille).
- **precisionStrict = 50 %** (17/34, bonne famille).
- **precisionContentFound = 100 %** (34/34, aucune proposition fabriquée ou étrangère au document).

L'écart de 33 points entre les deux mesures de recall s'explique presque uniquement par un seul blocage structurel : la famille reservation (les 7 avis suspendus du rapport de contrôle technique) n'est jamais produite par le pipeline, alors que son contenu est intégralement retrouvé sous d'autres familles. Le second facteur du déficit est un angle mort sur l'en-tête administratif du rapport (pages 2 à 4), largement absent des propositions.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Partial | Missed | Misclassified | Recall | Propositions | Vrai positif | Misclassified | Précision |
|---|---|---|---|---|---|---|---|---|---|---|
| person | 4 | 4 | 0 | 0 | 0 | 100 % | 4 | 4 | 0 | 100 % |
| company | 4 | 3 | 0 | 1 | 0 | 75 % | 3 | 3 | 0 | 100 % |
| knowledge_fact | 9 | 2 | 1 | 6 | 0 | 27,78 % | 14 | 10 | 4 | 71,43 % |
| reservation | 7 | 0 | 0 | 0 | 7 | 0 % | 0 | 0 | 0 | n/a (0 proposition) |
| decision | 0 | 0 | 0 | 0 | 0 | n/a (0 réf.) | 1 | 0 | 1 | 0 % |
| observation | 0 | 0 | 0 | 0 | 0 | n/a (0 réf.) | 12 | 0 | 12 | 0 % |
| deadline | 0 | 0 | 0 | 0 | 0 | n/a (0 réf.) | 0 | 0 | 0 | n/a (0 proposition) |
| action | 0 | 0 | 0 | 0 | 0 | n/a (0 réf.) | 0 | 0 | 0 | n/a (0 proposition) |

La lecture croisée est explicite dans les chiffres : les 7 éléments reservation manqués en classification stricte réapparaissent comme les 12 propositions observation et 1 des 1 proposition decision, toutes marquées misclassified — précision 0 % sur ces deux familles alors que leur contenu n'est pas inventé, simplement mal étiqueté.

## Biais systématiques identifiés

**1. Famille reservation absente à 100 % côté MemorIA (0 proposition sur 34).** Elle représente pourtant 7/24 éléments de référence : les 7 avis suspendus S1, S2, S3, S8, S9, S10, S11 du rapport de contrôle technique. Leur contenu est intégralement retrouvé (17 propositions au total, cf. E15 à E21), mais reclassé en observation (12 propositions), knowledge_fact (4 propositions) ou, pour le sous-point le plus sensible, en decision (1 proposition) — une famille par ailleurs absente de la référence sur ce document entier.

**2. Cadrage actif erroné sur la réserve S10 (suppression de la porte de recoupement).** La proposition dec-suppression-porte-recoupement-p7 est étiquetée famille decision avec la justification Décision explicite de suppression d'un élément du projet, alors que le document source est un avis technique suspendu d'un contrôleur tiers en attente de réponse, sans décideur ni réunion associés. Le contenu textuel repris est fidèle, mais le cadrage suggère à tort qu'un choix a déjà été arrêté par la maîtrise d'ouvrage/d'œuvre — signalé en factualFidelityIssues, sévérité modérée.

**3. Angle mort sur l'en-tête administratif du rapport (§1 et §2, pages 2 à 4).** Six éléments manqués y sont concentrés : dossier d'assurance/commande (E08), périmètre de mission LP+LE+SEI+STI (E09), montant/délai (E10), classification réglementaire ERP/CDT/thermique/vent-neige (E11), liste des pièces reçues (E12), et l'entité SECC en tant que société (E13, alors que son contenu technique est bien exploité ailleurs via E15). Ces éléments précèdent le corps technique du rapport (page 5 et suivantes), ce qui suggère un point faible structurel sur les rubriques de fiche d'identité plutôt qu'un échec aléatoire.

**4. Contradiction de statut sur 2 propositions issues de S1.** c1ccf56d-6a25-4f92-9988-16f61638e179 (renforcement de charpente) et da86211a-be6e-4e17-b937-3ef756a792bb (traitement CTB-P+) portent document_status='done', contradictoire avec leur propre source_payload.statusAtDocumentDate='à réaliser'. Un consommateur du seul champ document_status afficherait à tort ces travaux recommandés comme déjà réalisés — signalé en factualFidelityIssues, sévérité faible.

**5. Sur-fragmentation conforme au biais déjà documenté sur le corpus.** E14 (liste des travaux du §3.2) est éclatée en 7 propositions et E23 (demandes de communication du §6) en 3 propositions, sans perte de contenu ni erreur de famille sur ces deux éléments.

**6. Aucune hallucination détectée.** Le budget affiché à 0 € HT (E10, vraisemblablement un champ de modèle non renseigné) n'est ni repris ni remplacé par une valeur inventée. L'avis S5 (éclairage de sécurité), signalé par la référence comme une irrégularité du document source car sans texte STI correspondant, n'a donné lieu à aucune proposition fabriquée par MemorIA pour combler ce vide.

## Doublons internes à MemorIA

comparison.json ne contient pas de section duplicateProposalsWithinMemoria pour ce document — aucun doublon n'est signalé.

## Section spéciale — Photos

**0 photo des deux côtés.** Le document est purement textuel/tabulaire sur ses 14 pages (logo en en-tête et paraphe manuscrit en dernière page uniquement, sans contenu factuel propre). Les 32 evidence produites par MemorIA sont toutes de type text_excerpt, cohérent avec l'attendu. Aucune comparaison photo détaillée n'est nécessaire sur ce document.

## Éléments manqués

7 éléments de référence sur 24 sont MISSED :

| Élément | Famille | Contenu |
|---|---|---|
| E08 | knowledge_fact | Dossier d'assurance dommages-ouvrage, commande n° P-CT77-2020-20-100788 notifiée le 03/11/2020 (§1, page 2) |
| E09 | knowledge_fact | Mission de contrôle technique LP+LE+SEI+STI, ouvrage non exceptionnel (§1.9/1.10, page 2) |
| E10 | knowledge_fact | Montant prévisionnel 0 € HT et délai de 2 mois (§1.7/1.8, page 2) |
| E11 | knowledge_fact | Classification réglementaire du §2 : travaux dans l'existant, ERP type W catégorie 5, CDT H≤8m, catégorie thermique CE2, zones de vent/neige |
| E12 | knowledge_fact | Dossier PRO reçu les 14 et 20.01.2021 et étude de faisabilité SECC du 15.02.2021 (§3.1, page 4) |
| E13 | company | SECC, auteure de l'étude de faisabilité structure/charpente — non extraite comme entité company (contenu technique exploité ailleurs, mais aucune fiche société dédiée) |
| E22 | knowledge_fact | Synthèse du chapitre 5 : répartition F/D/S/SO/HM, 11 avis suspendus S1 à S11, 0 avis défavorable |

## Synthèse

Sur AUT_004, l'écart entre recallContentFound (71 %) et recallStrict (38 %) n'est pas un problème de perte de contenu mais un problème de classification concentré sur une seule famille : reservation n'est jamais déclenchée par le pipeline sur ce document, alors que les 7 avis suspendus du rapport sont tous retrouvés textuellement sous observation, knowledge_fact ou, dans un cas plus problématique, decision. Le second point faible est un angle mort sur l'en-tête administratif (fiche d'identité de la mission, pages 2 à 4), entièrement absent des propositions alors que le corps technique du rapport (nature des travaux, réserves, demandes de communication) est couvert de façon fidèle et parfois sur-fragmentée. Aucune hallucination n'est détectée (precisionContentFound = 100 %) : le déficit de ce document est un problème de couverture et de classification, pas d'invention. Le point le plus actionnable reste le cadrage erroné en decision de la réserve S10 (suppression de la porte de recoupement), qui ne se limite pas à une étiquette de famille inexacte mais suggère à tort qu'un choix a déjà été arrêté.