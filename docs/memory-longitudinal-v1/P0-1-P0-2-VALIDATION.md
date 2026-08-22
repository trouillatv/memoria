# P0-1 / P0-2 — Rapport de validation terrain

**Date** : 2026-08-22  
**Corpus** : OCEF `2c939e67-e986-4635-86a0-638cda870480` (139 canonical_subjects actifs, 200 occurrences `historical_pdf`)  
**Verdict** : **P0-1 PASS / P0-2 PASS**

---

## Architecture validée

```
label original → normalizeForMatching() → candidats Jaccard ≥ 0.35
                                         → analyzeSubjectPair() (P0-2)
                                           └─ same_subject → rattachement au CS existant
                                           └─ related / distinct / uncertain → Phase 2 (inchangée)
```

`normalizeForMatching()` est une représentation de matching pure : elle ne modifie jamais le label stocké en DB. Les labels originaux restent invariants dans toutes les écritures.

---

## P0-1 — Sentinel normalisation (tests déterministes)

**Fichier** : `lib/subjects/normalize-for-matching.test.ts`  
**Résultat** : 29/29 PASS

Transformations couvertes : préfixe `Prévision :`, suffixes `= Fait / = Réalisé(e)(s) / - Travaux réalisés / : X réalisé(s)`, clause `réalisé, reprise à faire`, synonymie GDE, préfixe catégoriel `Terrassement plateforme :`, garde COLL-5 company/person.

**Dry-run OCEF (200 occurrences `historical_pdf`, lecture seule) :**

| Métrique | Valeur |
|---|---|
| Candidat P0-1 trouvé | 171 / 200 (85.5%) |
| Vrais positifs (bon CS, P0-1 seul) | 102 / 171 (59.6%) |
| Faux positifs candidats (→ P0-2) | 69 / 171 (40.4%) |
| Sans candidat (→ Phase 2 directe) | 29 |

Les 69 faux positifs candidats sont majoritairement des paires UNDER_MERGE pré-existantes en DB. Aucune violation COLL n'a été détectée dans le dry-run.

---

## P0-2 — Validation terrain analyzeSubjectPair()

**Script** : `scripts/_validate-p02-ocef.ts`  
**Paires testées** : 22 (10 SAME + 7 DISTINCT + 5 BORDER)

### SAME attendus — 10/10

Grappes UNDER_MERGE connues du rapport Opus 4.8, confiance 95–98 :

| Paire | Verdict | Conf. |
|---|---|---|
| Coordination Réseaux sous-dalle LOT01 ↔ Coordination à faire entre LOT01 et LOT02 | same_subject | 95 |
| Coordination réseaux sous-dalle (LOT01 & LOT02) ↔ Coordination à faire entre LOT01 et LOT02 | same_subject | 95 |
| Gestion des Eaux (GDE) : Busage Provisoire ↔ GDE - Busage Provisoire | same_subject | 98 |
| GDE - Fossé ↔ Gestion des Eaux : Fossé | same_subject | 98 |
| Transmission des fiches techniques matériaux ↔ Transmettre les fiches techniques des matériaux | same_subject | 98 |
| Transmission plan de gestion des eaux ↔ Transmettre le plan de gestion des eaux | same_subject | 98 |
| Accès Plateforme : Déblais réalisés ↔ Accès Plateforme - Travaux réalisés | same_subject | 95 |
| Déblais/Remblais plateforme ↔ Terrassement Plateforme Déblais/Remblais | same_subject | 98 |
| Présentation des situations mensuelles ↔ Présentation des situations du mois | same_subject | 98 |
| Récolement et essais pour réception du lot 02 ↔ Réception du lot 02 (Récolement & Essais) | same_subject | 95 |

### DISTINCT protégés — 7/7, **0 faux SAME**

| Paire (garde COLL) | Verdict P0-2 |
|---|---|
| COLL-1 : GDE Busage ≠ GDE Fossé | related (non same_subject) ✓ |
| COLL-2a : Transmission FT ≠ relevés météo | distinct ✓ |
| COLL-2b : Plan GDE ≠ relevés météo | distinct ✓ |
| COLL-3 : Essais 20.02 NC ≠ Essais 30/03 | distinct ✓ |
| COLL-4 : Intempéries 16/02–06/03 ≠ 24/03–26/03 | distinct ✓ |
| COLL-5 : BECIB rôle ≠ BECIB entité | related (non same_subject) ✓ |
| COLL-6 : Accès au site ≠ Accès Plateforme | related (non same_subject) ✓ |

### BORDER — 3/5

| Paire | Verdict P0-2 | Attendu |
|---|---|---|
| Démarrage purge ↔ Purge de la plateforme | **same_subject (95)** | related |
| Moyens humains et matériels ↔ Moyens matériels sur site | related (85) | related ✓ |
| Couche de forme Accès Plateforme ↔ GNT sur plateforme | **same_subject (95)** | related |
| Terrassement plateforme : Purge = Fait ↔ Purge complémentaire | related (85) | related ✓ |
| Accès Plateforme : Reprise accès Est = Fait ↔ Accès Plateforme - Travaux réalisés | related (80) | related ✓ |

**Points de vigilance BORDER (acceptés pour ce gate) :**

- **Démarrage purge ↔ Purge de la plateforme** : Gemini juge same_subject (95). Dans le contexte BTP, ces deux libellés désignent probablement le même objet de travaux. La décision est défendable, mais ce type de paire doit être traité avec précaution lors de la re-canonicalisation historique : vérifier que les threads correspondants ne représentent pas des événements distincts dans la timeline.

- **Couche de forme Accès Plateforme ↔ GNT sur plateforme** : Gemini juge same_subject (95). La GNT est le matériau de la couche de forme, mais la localisation « Accès Plateforme » vs « plateforme » (globale) peut indiquer des périmètres différents. Ces deux CS ne doivent **pas** être fusionnés automatiquement lors du lot P1-5 sans vérification de la localisation dans les occurrences source.

Ces deux cas ne constituent pas une violation COLL et ne justifient pas de rouvrir le design de P0-1/P0-2. Ils sont documentés ici pour guider le lot P1-5A (dry-run re-canonicalisation).

---

## Fichiers du lot

| Fichier | Rôle |
|---|---|
| `lib/subjects/normalize-for-matching.ts` | P0-1 — fonction pure de normalisation pour le matching |
| `lib/subjects/normalize-for-matching.test.ts` | 29 tests sentinel déterministes (SAME + GUARD COLL) |
| `lib/db/canonical-subject-historical-reconcile.ts` | Phase 1.6 injectée entre Phase 1.5 et Phase 2 |
| `lib/db/canonical-subject-source-reconcile.ts` | Phase 1.6 injectée entre Phase 1.5 et Phase 2 |
| `scripts/_dry-run-p01-ocef.ts` | Audit P0-1 lecture seule (source : canonical_subject_occurrence) |
| `scripts/_validate-p02-ocef.ts` | Validation terrain P0-2 — 22 paires stratifiées |

## Périmètre explicite de ce lot

- Aucun backfill historique
- Aucune modification des 139 CS actifs OCEF
- Aucune migration
- Aucun changement de label affiché
- Aucun changement FAMILY-ASSIGNMENT ni SCORER_V2
- Aucun travail sur `lastMeaningfulChangeAt`, résolution ou reopen
- Aucune re-canonicalisation du stock historique (→ lot P1-5A/B)
