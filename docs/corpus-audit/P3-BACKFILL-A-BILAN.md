# P3 — Backfill A : bilan final du modèle temporel d'occurrences

Date : 2026-08-28. Recette finale de P3 (D1 state_key + D2 event_date) appliquée au corpus
historique réel. **Modèle de données uniquement** — la Ligne de vie (`getCanonicalSubjectLife`)
reste sur son moteur de reconstruction par propositions : sa convergence est le lot **R-1**
(première phase de restitution), volontairement hors de ce lot.

## 1. Ce que ce lot garantit (et ce qu'il ne garantit pas)

- **GARANTI** : la connaissance longitudinale correcte est désormais **représentable et présente**
  dans `canonical_subject_occurrence`. Un sujet peut porter plusieurs états atomiques dans un même
  document (D1), et chaque état peut porter la date propre du fait quand elle est fiable (D2),
  distincte de la date du document.
- **NON garanti par ce lot** : que toutes les surfaces (Histoire, Ligne de vie, fiche sujet)
  l'**affichent** déjà correctement. La Ligne de vie ne lit pas cette table pour l'historique →
  R-1.

## 2. Exécution

- Snapshot complet avant écriture (`_backfillA_snapshot.json`, 418 occurrences + 12 liens acteur
  + composite), rollback outillé et testé (`--rollback`).
- Atomisation de la proposition composite Bella (« Contrôles électriques, éclairage et cuisson à
  refaire ») en 3 propositions atomiques — **même source_excerpt, même page, mêmes threads** vers
  électrique / éclairage / cuisson. Aucune histoire fabriquée : provenance partagée conservée.
- Rematérialisation des **20 rapports historiques** (Bella + 18 autres) par le workflow générique
  `ensureHistoricalPdfOccurrences` (suppression legacy → re-run D1+D2). Aucune règle spécifique
  Bella dans le moteur.

## 3. Bilan chiffré (état écrit, vérifié en base)

| Mesure | Avant | Après |
|---|---|---|
| Occurrences `historical_pdf` | 418 | **522** (+104, +25 %) |
| Couples (rapport, sujet) multi-état | — | **64** (multiplicité désormais exprimable) |
| `state_key` NULL | — | **0** (D1 intégralement peuplé) |
| `event_date` renseignées | 0 | **14** (D2 ; le reste `null` = position à la date du PV) |

**Explosion (après > 2× avant) : non.** Le +25 % vient de la dé-agrégation des documents qui
mélangeaient plusieurs états sous une seule occurrence documentaire — c'est la correction, pas un
effet de bord.

## 4. Anomalies

| Contrôle | Résultat |
|---|---|
| `event_date` > `effective_date` (fait postérieur au document) | **0** |
| `event_date` < 2015 (date aberrante) | **0** |
| Doublons (sujet, rapport, state_key) — violation d'idempotence D1 | **0** |
| `state_key` NULL | **0** |
| Dates ambiguës forcées à une valeur | **0** (laissées `null`) |

**Aucune réparation manuelle** sur les 18 autres rapports. **Aucune nouvelle classe structurelle**
détectée → pas de HARD STOP de blocage.

## 5. Témoin officiel du défaut P3-#3 (éclairage Bella) — en base

Le cas qui prouvait l'insuffisance du modèle (« défaut absorbé par un état voisin ») est maintenant
correctement représenté, sans pooling :

| État | state_key | document_date | event_date | source |
|---|---|---|---|---|
| Contrôle éclairage de sécurité **réalisé** | `knowledge_fact` | 2025-08-05 | **2024-03-22** | PV 2025 |
| Contrôle de l'éclairage **à refaire** | `action` | 2025-08-05 | `null` (→ position = PV) | PV 2025 |

Les deux proviennent du même PV du 05/08/2025 (`source_ref_id` + `effective_date` communs), mais le
fait « contrôle réalisé » est positionné au 22/03/2024 (`event_date`) et non à la date du PV.

Acquis Bella vérifiés en base : cuisson continuité 2024→2025 ✅ · électrique (Fait 2024 +
à refaire) ✅ · registre 2024 présent ✅ · extincteurs 3 états ✅.

## 6. Rollback

Disponible et non détruit : `npx tsx --env-file=.env.local scripts/backfill-a-execute.ts --rollback`
(réinsère les 418 occurrences + 12 liens du snapshot, restaure le libellé composite, supprime les
2 propositions atomiques ajoutées).

## 7. Suite (ordre validé) — après GO

1. **R-1** — convergence Ligne de vie / Histoire vers le modèle d'occurrences (première restitution).
2. Audit écran par écran.
3. Planning (aucun changement dans ce lot).
4. 3ᵉ PV Bella à froid.
5. Autres matières, puis démo.
6. **CR 2026** = recette end-to-end.

**HARD STOP.**
