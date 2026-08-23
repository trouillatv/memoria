# P1-4A — Rapport d'implémentation LMCA unifié

Date : 2026-08-23  
Statut : CODÉ / COMPILÉ / TESTÉ — **HARD STOP — attente GO Vincent**

---

## Verdict gate

**P1_4A_PASS**

- 3 FP OCEF corrigés (Regard R4, Récolement, Débroussaillage)
- 1/3 FN PETRO partiellement corrigé (Cadenas via Level 2 action)
- 0 régression sur les cas déjà corrects (Assainissement, Eau panneaux)
- 139/139 tests verts (P1-3B + P1-4A pure sentinels)
- Typecheck : 0 erreur

---

## Résultat fonctionnel

Unification des trois logiques LMCA divergentes autour d'une fonction pure unique `computeLmcaFromOccurrences` (dans `lib/documents/subject-state.ts`). Tous les blocs projettent désormais les statuts sources vers le modèle P1-3 (`PvState`) avant de détecter un changement significatif.

**Niveau 1 (transitions P1-3)** : seuls RESOLVED (open→resolved) et REOPEN (resolved→open) font avancer LMCA. `unknown` ne met pas à jour l'état antérieur. `unknown→open` = conservativement non significatif.

**Niveau 2 (objets matérialisés)** : pour Block A/B PDF → `matSig` par run (inchangé). Pour Block B terrain (nouveau) → `created_at` des objets liés par `canonical_subject_id` (mig 346) postérieurs à `firstSeenAt`.

---

## Tableau avant/après (7 sujets sentinel)

| Sujet | CS (préfixe) | LMCA avant | LMCA après | Verdict |
|---|---|---|---|---|
| PETRO — Cadenas | 6801ce5c | 2026-07-20 | **2026-08-12** | FN partiellement fixé (Level 2 — action créée le 08-12) |
| PETRO — Planning | 14cd6eaa | 2026-07-20 | 2026-07-20 | FN conservé (aucun objet terrain lié) — limite assumée |
| PETRO — Eau panneaux | 1d41b3f1 | 2026-08-18 | 2026-08-18 | Correct → inchangé (occurrence unique, action même date) |
| OCEF — Assainissement | f5cf3a19 | 2026-07-16 | 2026-07-16 | Correct → inchangé (transitions REOPEN/RESOLVED détectées) |
| OCEF — Regard R4 | 4fb967c3 | **2026-08-06** | 2026-07-16 | **FP corrigé** (field_checked+mentioned → unknown, pas de trigger) |
| OCEF — Récolement | f2c85807 | **2026-07-02** | 2026-04-16 | **FP corrigé** (done→null→done : même état, null=unknown) |
| OCEF — Débroussaillage | 5305d854 | **2026-04-30** | 2026-02-12 | **FP corrigé** (done constant, null intercalé ignoré) |

---

## Changements

### `lib/documents/subject-state.ts` (ajouts)
- `visitStatusToPvState(status)` : `still_open→open`, `not_applicable→resolved`, tout le reste→`unknown`
- `LmcaOccurrence` interface : `{ effectiveDate, pvState, objectSig }`
- `computeLmcaFromOccurrences(occs)` : moteur pur L1 (RESOLVED/REOPEN) + L2 (objectSig)

### `lib/knowledge/evolution-metrics.ts` (Block C)
- Import des fonctions P1-3 depuis `subject-state`
- `type Event` étendu : ajout `sourceKind` pour router la projection correcte
- Remplacement du loop raw-string par `computeLmcaFromOccurrences`

### `lib/db/canonical-subject-life.ts` (Blocks A + B)
- Import de `visitStatusToPvState`, `computeLmcaFromOccurrences`, `type LmcaOccurrence`
- **Block A** (`getCanonicalSubjectLife`, ~l.642) : projection `visitStatus→visitStatusToPvState` / `documentStatus→documentStatusToPvState` + `matSigByRun` → `computeLmcaFromOccurrences`
- **Block B** (`getNavigableSubjectsForSite`, ~l.1263) : même projection + Level 2 terrain
- **2B-ter étendu** : `select('id, canonical_subject_id, created_at')` sur `site_actions` et `site_deadlines`. Collecte `csObjectDates` par `canonical_subject_id`.
- Level 2 terrain (nouveau) : dans la boucle par CS, filtre `created_at > firstSeenAt` et avance LMCA si supérieur.

### `lib/documents/subject-state.test.ts` (ajouts)
- 6 tests `visitStatusToPvState`
- 9 tests `computeLmcaFromOccurrences` (all-unknown, RESOLVED, REOPEN, FP-1, FP-2, unknown→open conservatif, PETRO Level 2, open×3)

### `tests/knowledge/evolution-metrics.test.ts` (mises à jour)
- 3 tests mis à jour pour refléter la nouvelle sémantique P1-4A :
  - `null→still_open` : LMCA reste au baseline (unknown→open non significatif)
  - `still_open→field_checked` : pas un RESOLVED (field_checked→unknown)
  - `fv(null)+meeting(mentioned)` : cwc=1 (mentioned→unknown)

---

## Vérifications

| Vérification | Commande | Résultat |
|---|---|---|
| Tests pure sentinel P1-4A | `vitest run lib/documents/subject-state.test.ts` | 69/69 PASS |
| Tests Block C | `vitest run tests/knowledge/evolution-metrics.test.ts` | 10/10 PASS |
| Suite P1-3B complète | `vitest run lib/documents/subject-reconciliation.test.ts ...` | 139/139 PASS |
| Typecheck | `tsc --noEmit` | 0 erreur |
| Sentinel terrain DB | computation manuelle sur 7 sujets | P1_4A_PASS (voir tableau) |

---

## Limites assumées

- **PETRO Planning (14cd6eaa)** : aucun objet terrain lié → LMCA reste figée. Acceptable V1 : la reformulation label/description ("retard", "Yann") n'est pas un signal structuré exploitable sans LLM (Level 3 reporté).
- **PETRO Eau panneaux (1d41b3f1)** : action créée le même jour que firstSeenAt → filtre `created_at > firstSeenAt` l'exclut. Cas limite acceptable.
- **Level 2 Block A** (getCanonicalSubjectLife) : terrain objects via canonical_subject_id pas encore intégrés à Block A. Seul Block B en bénéficie. Extension possible si la vue détail PETRO en a besoin.
- **unknown→open** : conservativement non significatif. La P1-3C.2 a montré que les signaux "open" post-unknown sont souvent des faux positifs de classification.

---

## Reste et opérations manuelles

- **HARD STOP atteint** : aucun commit sans GO explicite Vincent
- Après GO : `git add` ciblé + commit + push
- Pas de migration, pas de mutation DB dans ce lot

