# P1-5B — Re-canonicalisation contrôlée OCEF

**Date :** 2026-08-22
**Engine :** p1-5b-v1
**Site :** OCEF Compostage (2c939e67-e986-4635-86a0-638cda870480)
**Durée totale :** 34s

## Verdict

**PASS** — 27 fusions exécutées avec succès. Aucune anomalie détectée.

## Statistiques

| Métrique | Valeur |
|---|---|
| CS actifs avant P1-5B | 157 (audit P1-5A : 131, +26 ajoutés depuis 2026-08-02) |
| Fusions exécutées | 27 |
| CS actifs après P1-5B | 130 |
| Grappes CLEAN | 15 |
| Grappes Choix B | 2 (GNT + Purge) |
| CS isolés préservés (Choix B) | 2 (Prévision GNT + Démarrage purge) |
| canonical_subject_links reroutés | 0 |
| Self-links supprimés | 0 |
| Liens dupliqués supprimés | 0 |

## Choix B — Frontières RELATED préservées

| Paire | Décision |
|---|---|
| Réalisation Purge Plateforme ↔ Démarrage purge plateforme | DISTINCT (arête RELATED — frontière de composante) |
| Mise en place couche de forme (GNT) ↔ Prévision : Mise en place couche de forme | DISTINCT (arête RELATED — frontière de composante) |

## Détail des fusions

| Grappe | Fusion | Links reroutés | Self-links supprimés | Duplic. supprimés | Durée |
|---|---|---|---|---|---|
| Coordination LOT01/LOT02 | Coordination Réseaux sous-dalle LOT01 et LOT02 → Coordination à faire entre LOT01 et LOT02 | 0 | 0 | 0 | 0ms |
| Coordination LOT01/LOT02 | Coordination réseaux sous-dalle (LOT01 & LOT02) → Coordination à faire entre LOT01 et LOT02 | 0 | 0 | 0 | 0ms |
| Coordination LOT01/LOT02 | Prévision : Coordination Réseaux sous-dalle LOT01 et LOT02 → Coordination à faire entre LOT01 et LOT02 | 0 | 0 | 0 | 0ms |
| Transmission fiches techniques | Transmission fiches techniques matériaux → Transmission des fiches techniques matériaux | 0 | 0 | 0 | 0ms |
| Journal de chantier | Tenir à jour un journal de chantier → Journal de chantier à tenir à jour | 0 | 0 | 0 | 0ms |
| GDE - Fossé | Gestion des Eaux (GDE) : Fossé → GDE - Fossé | 0 | 0 | 0 | 0ms |
| GDE - Fossé | Fossé GDE → GDE - Fossé | 0 | 0 | 0 | 0ms |
| GDE - Busage Provisoire | Gestion des Eaux (GDE) : Busage Provisoire → GDE - Busage Provisoire | 0 | 0 | 0 | 0ms |
| GDE - Busage Provisoire | Busage Provisoire GDE → GDE - Busage Provisoire | 0 | 0 | 0 | 0ms |
| Relevés météo | Transmission des relevés météo → Transmettre les relevés météo | 0 | 0 | 0 | 0ms |
| Relevés météo | Transmission relevés météo → Transmettre les relevés météo | 0 | 0 | 0 | 0ms |
| Couche de forme GNT | Mise en place de la couche de forme → Mise en place couche de forme (GNT) | 0 | 0 | 0 | 0ms |
| Accès Plateforme - Travaux réalisés | Accès Plateforme : Déblais réalisés → Accès Plateforme - Travaux réalisés | 0 | 0 | 0 | 1146ms |
| BECIB interlocuteur LOT01 | BECIB interlocuteur privilégié de l'entreprise pour le lot 01 → BECIB est l'interlocuteur privilégié de l'entreprise pour le lot 01 | 0 | 0 | 0 | 1071ms |
| BECIB interlocuteur LOT01 | BECIB interlocuteur privilégié pour le lot 01 → BECIB est l'interlocuteur privilégié de l'entreprise pour le lot 01 | 0 | 0 | 0 | 1027ms |
| Plan gestion des eaux | Transmission plan de gestion des eaux → Plan de gestion des eaux pluviales | 0 | 0 | 0 | 1051ms |
| Plan gestion des eaux | Transmission du plan de gestion des eaux → Plan de gestion des eaux pluviales | 0 | 0 | 0 | 1050ms |
| Moyens matériels sur site | Moyens matériels présents sur site → Moyens matériels sur site | 0 | 0 | 0 | 1033ms |
| Moyens matériels sur site | Moyens matériels présents → Moyens matériels sur site | 0 | 0 | 0 | 1022ms |
| Moyens matériels sur site | Moyens humains et matériels sur site → Moyens matériels sur site | 0 | 0 | 0 | 1034ms |
| Terrassement Plateforme Déblais/Remblais | Déblais/Remblais plateforme → Terrassement Plateforme Déblais/Remblais | 0 | 0 | 0 | 1021ms |
| Purge Plateforme | Purge de la plateforme → Réalisation Purge Plateforme | 0 | 0 | 0 | 1024ms |
| Purge Plateforme | Terrassement plateforme : Démarrage purge → Démarrage purge plateforme | 0 | 0 | 0 | 1029ms |
| Reprise accès sortie | Reprise accès Est → Prévision : Reprise accès (sortie) | 0 | 0 | 0 | 1036ms |
| Propreté abords chantier | Attention à la propreté générale des abords du chantier → Propreté des abords du chantier | 0 | 0 | 0 | 1046ms |
| Visite mairie secteur sous plateforme | Assainissement : Visite de la mairie → Visite mairie secteur sous plateforme | 0 | 0 | 0 | 1023ms |
| Transmission Rapport/CR Visite Mairie | Rapport mairie → Transmission Rapport/CR Visite Mairie | 0 | 0 | 0 | 1046ms |

## Journal de traçabilité

Toutes les fusions sont journalisées dans `canonical_subject_merge` avec :
- `engine_version = 'p1-5b-v1'`
- `resolution_source = 'automatic'`
- `p02_confidence = 90`
- Snapshot complet (links_snapshot_before, moved_link_ids, moved_occurrence_ids, moved_thread_ids)

## État post-P1-5B

- P1-5B : **CLOS**
- Prochaine étape : P1-3 / P1-4 (lastSeenAt / lastMeaningfulChangeAt) débloqués
- Idempotence théorique : 9 paires résiduelles P0-1 toutes DISTINCT par P0-2 (voir P1-5A dry-run)
