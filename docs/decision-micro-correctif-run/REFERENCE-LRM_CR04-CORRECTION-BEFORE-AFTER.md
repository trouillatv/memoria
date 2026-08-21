# LRM_CR04 — Corrections de Référence

Source : rapport Opus `REFERENCE-LRM_CR04-CORRECTIONS.md` (audit documentaire pur).
Appliqué : 2026-08-21 dans `docs/qualification-runs/LRM_CR04/reference.json`.
Aucune ré-extraction, aucun Gemini, aucun PDF.

---

## Avant Correction

| ID | Famille | Extrait (60c.) | Motif de changement |
|----|---------|----------------|---------------------|
| E40 | decision | La couverture des deux premières travées (n°1 et 2) réalisée en 1995… | Fait passé daté → knowledge_fact |
| E41 | decision | Prévoir un petit chéneau en plomb, largeur environ 10cm… | Prescription impérative → action |
| E42 | decision | Le panneau de chantier sera installé sur le pignon de l'ossuaire… | Consigne logistique (futur d'exécution) → action |
| E43 | decision | Sous-traitant pour les travaux électriques : entreprise Archéol… | Désignation de sous-traitant → company (doublon E22) |
| E44 | decision | L'entreprise indique réaliser les relevés des sculptures des corniches… | Annonce d'un mode opératoire → action (prestataire déjà en E23) |

## Après Correction

| ID | Famille | Extrait (60c.) | Confiance | Justification métier |
|----|---------|----------------|-----------|----------------------|
| E40 | **knowledge_fact** | La couverture des deux premières travées (n°1 et 2) réalisée en 1995… | MEDIUM | Fait passé daté (1995, CCA) + report d'échéance à TC2 ; aucun arbitrage entre options concurrentes ; « voir si la volige peut être conservée » = investigation, pas décision |
| E41 | **action** | Prévoir un petit chéneau en plomb, largeur environ 10cm… | HIGH | Prescription impérative (« Prévoir… ») confiée à UDOC, sans alternative pesée |
| E42 | **action** | Le panneau de chantier sera installé sur le pignon de l'ossuaire… | HIGH | Tâche logistique au futur d'exécution, sans option concurrente |
| E43 | **company** | Sous-traitant pour les travaux électriques : entreprise Archéol… | MEDIUM | Désignation d'un sous-traitant — même nature que E22 déjà classé company sur ce passage (doublon interne = preuve) |
| E44 | **action** | L'entreprise indique réaliser les relevés des sculptures des corniches… | MEDIUM | Déclaration d'un mode opératoire (scanérisation avec IMAGINE 3D) ; prestataire déjà en E23 company |

---

## Vérification

- Décisions gelées LRM avant correction : **10** (E38 → E47)
- Décisions reclassées : E40 → knowledge_fact, E41 → action, E42 → action, E43 → company, E44 → action
- Décisions confirmées inchangées : E38, E39, E45, E46, E47
- Décisions restantes LRM après correction : **5** ✓

```
count(family == "decision") dans LRM_CR04/reference.json = 5
```

---

## Tableau exhaustif des 17 decisions référence après correction

Corpus MEL_CR03 (5) + LRM_CR04 corrigé (5) + JAR_CR04 (2) + EAU_001 (5) = 17 decision.

Sources gelées utilisées :
- `docs/qualification-runs/*/reference.json` (LRM corrigé)
- `docs/decision-micro-correctif-run/DECISION-MICRO-CORRECTIF-RESULTS.json` (12 extractions gelées)
- Matcher `scripts/benchmark-decision-matcher.ts` (coefficient d'overlap ≥ 0.50)

| Corpus | ID | Extrait (60c.) | Statut gelé | Statut rescoré | Cause | Notes |
|--------|----|----------------|-------------|----------------|-------|-------|
| MEL_CR03 | E48 | Les Elus ont validés cette technique en réunion. | matched | **MATCHED** | — | Inchangé ✓ |
| MEL_CR03 | E55 | Rappel : La pose d'un dalot de décharge des Eaux pluviales… | missed | **MATCHED** | MATCHER_FN_RÉCUPÉRÉ | overlap 1.00 vs FP excerpt identique ; slice(0,50) divergeait sur le label court ; FP absorbé disparaît |
| MEL_CR03 | E56 | Rappel : Le positionnement du poste de relevage rue du moulin… | matched | **MATCHED** | — | Inchangé ✓ |
| MEL_CR03 | E61 | 3 rue des Pothières (Pb): il a été décidé de transférer le compteur… | matched | **MATCHED** | — | Inchangé ✓ |
| MEL_CR03 | E75 | La prise en charge des sauterelles à 50% par la commune et 50%… | matched | **MATCHED** | — | Inchangé ✓ |
| LRM_CR04 | E38 | A priori, et afin de conserver les deux premières travées… | matched | **MATCHED** | — | Confiance MEDIUM (conditionnel) ; inchangé ✓ |
| LRM_CR04 | E39 | Pour le versant Nord, le rang de pierre serait conservé sur tout… | matched | **MATCHED** | — | Confiance MEDIUM (conditionnel) ; inchangé ✓ |
| LRM_CR04 | E40 | La couverture des deux premières travées réalisée en 1995 par CCA… | missed | **HORS PÉRIMÈTRE** | REFERENCE_ERROR → knowledge_fact | Fait passé daté, pas d'arbitrage ; retiré du dénominateur |
| LRM_CR04 | E41 | Prévoir un petit chéneau en plomb, largeur environ 10cm… | missed | **HORS PÉRIMÈTRE** | REFERENCE_ERROR → action | Prescription impérative ; retiré du dénominateur |
| LRM_CR04 | E42 | Le panneau de chantier sera installé sur le pignon de l'ossuaire… | missed | **HORS PÉRIMÈTRE** | REFERENCE_ERROR → action | Consigne logistique ; retiré du dénominateur |
| LRM_CR04 | E43 | Sous-traitant pour les travaux électriques : entreprise Archéol… | missed | **HORS PÉRIMÈTRE** | REFERENCE_ERROR → company | Désignation sous-traitant, doublon E22 ; retiré du dénominateur |
| LRM_CR04 | E44 | L'entreprise indique réaliser les relevés des sculptures… | missed | **HORS PÉRIMÈTRE** | REFERENCE_ERROR → action | Mode opératoire, prestataire en E23 ; retiré du dénominateur |
| LRM_CR04 | E45 | Pour ce qui est de la reprise des enduits, indiquée pour la 1ère quinzaine… | missed | **MISSED** | EXTRACTION_MISSED | overlap max 0.17 vs les 3 extraits gelés ; non récupérable |
| LRM_CR04 | E46 | il sera souhaitable de les différer APRES cette intervention… | missed | **MISSED** | EXTRACTION_MISSED | overlap max 0.00 ; non extrait |
| LRM_CR04 | E47 | Les deux premières travées (n°1 et 2) réalisée en 1995 seront conservées. | missed | **MISSED** | EXTRACTION_MISSED | overlap max 0.17 ; non extrait |
| JAR_CR04 | E61 | dépose du jeu de vannes actuellement pour permettre le raccordement… | missed | **MATCHED** | MATCHER_FN_RÉCUPÉRÉ | overlap 0.86 vs FP « Alimentation fonte 200… validée AGUR » ; première moitié omise → slice(0,50) ratait ; FP absorbé |
| JAR_CR04 | E77 | Arrêt du chantier sur cette voie à la moindre inquiétude. | missed | **MISSED** | EXTRACTION_MISSED | overlap 0.00 vs les 2 extraits ; non extrait |
| EAU_001 | E02 | Les communes situées sur le bassin versant ont décidé officiellement… | missed | **MISSED** | UPSTREAM_LOSS | Aucune extraction decision pour EAU_001 |
| EAU_001 | E05 | Cette instance a décidé : animer une stratégie territoriale commune… | missed | **MISSED** | UPSTREAM_LOSS | Aucune extraction decision pour EAU_001 |
| EAU_001 | E08 | Pour définir la stratégie, la CLE a décidé d'établir plusieurs… | missed | **MISSED** | UPSTREAM_LOSS | Aucune extraction decision pour EAU_001 |
| EAU_001 | E11 | ACTeon et l'animation du SAGE s'engagent à ce que les actions… | missed | **MISSED** | UPSTREAM_LOSS | Aucune extraction decision pour EAU_001 |
| EAU_001 | E14 | Il a été accordé, lors de la réunion entre gestionnaire AEP… | missed | **MISSED** | MISCLASSIFIED | Extrait produit en knowledge_fact (kf-etat-ressource-p6), pas en decision |

> Note : le tableau ci-dessus compte 22 lignes car les 5 lignes HORS PÉRIMÈTRE (E40–E44)
> restent présentes pour la traçabilité. Le dénominateur effectif est 17 (22 − 5).

---

## Tableau de synthèse — réconciliation mathématique

```
Références gelées total            : 22
  dont 5 REFERENCE_ERROR (LRM E40–E44) : reclassées hors decision
Références decision réelles (dénominateur corrigé) : 17

Extractions gelées (famille decision) : 12
  dont 3 LRM « FP » gelés   → famille reservation (E71/E74/E75 ref) → filtrées par matcher
  dont 2 JAR « FP » gelés   → 1 absorbé par E61 (MATCHED), 1 famille KF → filtré
  Extractions decision réelles         : 8

Matchés (run gelé + matcher réparé) :
  Matchés directs (6/22 gelé)          : 6
  + MATCHER_FN récupérés               : +2 (E55 MEL, E61 JAR)
  = Total matchés                      : 8

Missed réels (9) :
  UPSTREAM_LOSS (EAU_001)              : 4 (E02, E05, E08, E11)
  MISCLASSIFIED (EAU E14)             : 1 (produit en KF, pas en decision)
  EXTRACTION_MISSED (LRM séquencement) : 3 (E45, E46, E47)
  EXTRACTION_MISSED (JAR)              : 1 (E77)
  Total missed                         : 9 ✓ (8 matchés + 9 missed = 17)

Baseline corrigée :
  Recall    = 8 / 17  = 47.1%
  Precision = 8 / 8   = 100% (zéro FP decision réel)

Plafond théorique (sans correction prompt) :
  Si EAU_001 upstream résolu (4 matchs) + LRM séquencement (3 matchs) + JAR E77 (1 match)
  = 8 + 8 = 16/17 = 94%
  Réaliste (EAU_001 seul) : 8 + 4 = 12/17 = 71%
```

---

## Vérification des conditions de commit

| Condition | Statut |
|-----------|--------|
| Tous les tests matcher passent (27/27) | ✅ PASS |
| LRM reference.json = exactement 5 decision | ✅ VÉRIFIÉ |
| MEL-E55 récupérée (matcher-FN) | ✅ PROUVÉ (overlap 1.00) |
| JAR-E61 récupérée (matcher-FN) | ✅ PROUVÉ (overlap ≥ 0.86) |
| Aucune extraction Gemini relancée | ✅ |
| Tableau 17 éléments réconcilié sans ambiguïté | ✅ |
| Aucun changement moteur production (ligne 194) | ✅ |
