# Synthèse transversale finale — Qualification pipeline import PV historiques (Phase C + Phase D)

25 documents scorés (7 Phase C + 18 Phase D), 979 éléments de référence, 1038 propositions MemorIA. Chiffres exacts produits par `scripts/_qualification-phase-d-final-synthesis.ts`, données brutes dans `phase-d-final-synthesis-data.json`. Aucune correction moteur/prompt/modèle appliquée pendant cette campagne.

## 1. Baseline globale

| Indicateur | Valeur |
|---|---|
| Recall strict (bonne famille) | **58,48 %** (563 MATCHED + 19 PARTIAL / 979) |
| Contenu retrouvé (famille ignorée) | **78,86 %** (563+19+190 MISCLASSIFIED / 979) |
| Precision globale (bonne famille) | **79,09 %** (821 / 1038) |
| Taux de fabrication (FAUX POSITIFS) | **0,39 %** (4 / 1038) |
| Éléments manqués (MISSED, aucune trace) | 152 / 979 (15,5 %) |

Lecture : le pipeline retrouve la quasi-totalité du contenu réel du document (79 %), mais le range fréquemment dans la mauvaise famille métier (190 cas). L'hallucination est marginale (4 faux positifs sur 1038 propositions, 2 documents seulement : LRM_01, BTP_009, REC_001×2).

## 2. Matrice par famille — recall / precision / gravité

| Famille | Recall | Precision | Gravité | Nature dominante de l'écart |
|---|---|---|---|---|
| **observation** | **19,6 %** | 76,7 % | 🔴 Critique | 77/112 MISCLASSIFIED — absorbée par knowledge_fact |
| **decision** | **39,7 %** | 93,3 % | 🔴 Critique | 27/63 MISCLASSIFIED — absorbée par knowledge_fact/action |
| **knowledge_fact** | 46,5 % | **70,4 %** | 🟠 Élevée | 106/303 MISSED + panier receveur de 4 autres familles (precision la plus diluée) |
| **reservation** | 46,6 % | 72,2 % | 🟠 Élevée | 15/29 MISCLASSIFIED, échantillon faible (6 docs) |
| **deadline** | 59,1 % | 89,3 % | 🟡 Modérée | 18/55 MISCLASSIFIED — absorbée par knowledge_fact |
| **action** | 67,5 % | 88,3 % | 🟡 Modérée | 37/146 MISCLASSIFIED — vers knowledge_fact |
| **company** | 85,1 % | 94,3 % | 🟢 Faible | 17/114 MISSED — entités hors tableau de présence structuré |
| **person** | 91,1 % | 83,7 % | 🟢 Faible | famille la plus fiable, essentiellement stable |

## 3. Matrice défaut → fréquence → familles → gravité → cause probable

| # | Défaut | Fréquence | Familles touchées | Gravité | Cause probable |
|---|---|---|---|---|---|
| D1 | **Absorption vers knowledge_fact** (le panier "fourre-tout") | 190 MISCLASSIFIED au total, dont 77 observation + 27 decision + 18 deadline + 16 action | observation, decision, deadline, action → knowledge_fact | 🔴 Dominant, présent sur 20+ des 25 documents | Frontière de classification insuffisamment contrainte entre "fait général" et les familles à sémantique temporelle/décisionnelle plus étroite (une échéance datée, une observation ponctuelle datée, une décision actée restent capturées comme contenu mais mal typées) |
| D2 | **Sous-détection des entités hors tableau structuré** | 17/114 company MISSED, concentré sur documents avec tableau de présence formel (GRDF/ENEDIS sur JAR_CR04, entités citées uniquement en corps de texte) | company | 🟡 Modérée, structurel | Extraction d'entités company ancrée sur le tableau de présence en en-tête, pas sur une lecture narrative complète |
| D3 | **Échec total sur documents à texte quasi-inexistant** | 2 documents sur 25 (ENV_001, OPC_006) — 0 proposition sur 72 éléments de référence cumulés | Toutes (extraction nulle) | 🔴 Critique mais localisé | Document dominé par du contenu image (ENV_001 : 14 images, `no_extractable_text` au 1er essai ; OPC_006 : 1 image, aucun texte narratif significatif) — le pipeline ne bascule pas vers une lecture visuelle du contenu quand le texte est absent ou quasi absent |
| D4 | **Fragmentation cross-famille** | Présent sur la quasi-totalité des documents Phase D denses (JAR_CR04 : 5 cas, LRM_CR07, MEL_CR03…) | knowledge_fact receveur principal | 🟡 Modérée | Un même élément de référence est découpé en plusieurs propositions dont certaines changent de famille — cohérent avec D1, pas un défaut isolé |
| D5 | **Fidélité de légende photo dégradée** | Documenté sur JAR_CR04, VRD_005, BTP_009 (3/11 documents à photos) | evidence image (hors scoring familles) | 🟢 Mineure, ergonomique | Captions tronquées à 1-2 mots, rendant la correspondance légende réf. ↔ image MemorIA non vérifiable dans plus de la moitié des cas |
| D6 | **Fabrication de contenu (hallucination)** | 4 cas sur 1038 propositions (0,39 %) | company×1, deadline×1, knowledge_fact×1, reservation×1 | 🟢 Négligeable | Résiduel, aucun schéma récurrent identifié — n'est PAS le problème de ce pipeline |

## 4. Échecs techniques (trackés séparément des erreurs sémantiques, non comptés dans la baseline ci-dessus)

- **QHSE_003** — échec technique **persistant**, jamais résolu (timeout Gemini répété, 3 tentatives, dernière à 233985ms). Exclu de tout scoring, corpus scoré = 25 documents et non 26.
- **BTP_009** — échec technique **transitoire** : 1er essai timeout à 246900ms, 2e essai (rejeu strict, sans aucune modification) réussi à 152016ms. Scoré normalement sur la 2e sortie (recall 84,3 %, precision 88,6 %). Le hoquet technique est noté ici, pas mélangé aux statistiques sémantiques.

Ces deux cas confirment que les timeouts Gemini touchent une petite fraction du corpus (2/27 tentatives) sans schéma de cause commune identifié entre les deux (documents de tailles différentes : QHSE_003 échoue de façon persistante, BTP_009 réussit au simple rejeu).

## 5. Échecs sémantiques totaux (succès technique, zéro production)

**ENV_001** (Phase C, 34 éléments de référence) et **OPC_006** (Phase D, 38 éléments de référence) produisent chacun **0 proposition** malgré un statut technique `ready_for_review`. Ce schéma apparaît indépendamment dans les deux phases du benchmark, ce qui exclut le hasard : les deux documents partagent un profil de contenu **quasi dépourvu de texte narratif exploitable**, dominé par de l'image (ENV_001 : 14 images détectées, erreur `no_extractable_text` au premier essai avant réussite technique au second ; OPC_006 : 1 image, traitement anormalement rapide à 31s contre 100-200s en moyenne sur le reste du corpus — signe d'un contenu textuel quasi nul). Voir défaut D3 ci-dessus.

## 6. Axe caractéristique documentaire

**Présence de photos/evidence image — pas de corrélation forte avec le recall.** Moyenne pondérée du recall sur les 10 documents scorables avec photos : 59,3 % (284/479 éléments). Sur les 14 documents sans photo : 57,7 % (288,5/500 éléments). Écart non significatif — la présence de photos en elle-même n'aggrave ni n'améliore le recall. **Nuance critique (voir D3/§5)** : ce n'est pas "avoir des photos" qui est corrélé à l'échec, mais avoir **quasi uniquement** des photos et aucun texte narratif substantiel — JAR_CR04 (9 photos, 66,7 % recall) et VRD_005 (16 photos, 53,8 % recall) prouvent qu'un document richement illustré mais aussi riche en texte reste bien traité.

**Taille du document — pas de corrélation claire.** Le recall varie de 30 % à 96 % sans tendance monotone en fonction du nombre d'éléments de référence, aussi bien sur les petits documents (HER_CR01 : 20 éléments, 30 % ; LRM_01 : 25 éléments, 96 %) que sur les gros (LRM_CR04 : 85 éléments, 55,9 % ; JAR_CR02 : 102 éléments, 67,2 %).

**Type dominant de contenu — corrélation identifiée.** Les documents dont le contenu réel est majoritairement composé d'**observations de terrain** (constats d'avancement, contrôles ponctuels, états datés — plutôt que des décisions de réunion ou des actions à mener) héritent structurellement de la faiblesse de la famille observation (19,6 % de recall global, la pire des 8 familles) :
- EAU_001 (21/47 propositions réf. dominées par observation) : recall document 29,1 %, le 2e plus bas du corpus.
- AUT_004 (12/34 dominé par observation) : recall document 39,6 %.
- JAR_01 (23/104 avec forte composante observation) fait exception avec 72,9 % — mais reste sur cette famille précisément à 0 % de recall observation dans son détail (toutes les observations de JAR_01 sont absorbées par knowledge_fact, seul le reste du document tire la moyenne vers le haut).

À l'inverse, les documents de type "réunion de chantier classique" (dominante action/person/company — LRM_01, MEL_CR01, JAR_CR02, LRM_CR07) obtiennent des recalls documentaires plus stables (56 à 96 %), cohérent avec les bonnes performances des familles person/company/action.

## 7. Ce qui ne relève pas d'un défaut de fond

- **Fabrication quasi nulle** (0,39 %, 4 cas sur 1038) : le moteur ne hallucine pas de contenu inventé. C'est la propriété la plus solide du pipeline sur l'ensemble du corpus.
- **Person et company** (91,1 % et 85,1 % de recall, 83,7-94,3 % de precision) : familles fiables, pas de risque identifié à ce stade.

## 8. Arrêt volontaire

Cette synthèse s'arrête ici, conformément au périmètre de la campagne : aucune modification de prompt, de seuil, de modèle ou de pipeline n'a été proposée ni appliquée. Le défaut D1 (absorption vers knowledge_fact) est le point de plus fort effet de levier si une correction est engagée dans un lot séparé, compte tenu de son ampleur (190/979 éléments, présent sur la quasi-totalité du corpus) — mais cette décision n'appartient pas à cette campagne de qualification.
