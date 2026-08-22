# P1-5A — Re-canonicalisation historique : DRY-RUN

**Date** : 2026-08-22
**Site** : OCEF Compostage `2c939e67-e986-4635-86a0-638cda870480`
**Mode** : audit lecture seule strict — **aucune mutation DB, aucun merge, aucun backfill, aucune écriture**.
**Verdict final** : **`HUMAN_REVIEW_REQUIRED`** (voir §15).

Scripts d'audit read-only produits (réutilisables, aucun code de production modifié) :
- `scripts/_p15a-inventory.ts` — inventaire + génération des candidats P0-1
- `scripts/_p15a-classify.ts` — classification P0-2 (réutilise verdicts connus + Gemini sur paires non couvertes)
- `scripts/_p15a-simulate.ts` — simulation grappes / survivor / moves / relations / idempotence

Artefacts JSON : `audit-p15a-inventory.clean.json`, `audit-p15a-classify.clean.json`, `audit-p15a-simulate.clean.json`.

---

## 1 — Inventaire de l'état actuel OCEF

| Élément | Valeur |
|---|---|
| canonical_subject total | 407 |
| **actifs (`status='active'`)** | **139** (dont **131 hors acteurs** company/contact) |
| fusionnés (`status='merged'`) | 268 |
| split | 0 |
| canonical_subject_occurrence total | 206 |
| — historical_pdf | 200 |
| — field_visit | 2 |
| — meeting | 2 |
| subject_thread_identity | 404 |
| site_knowledge_proposals matérialisées (canonical_subject_id non null) | 1 |
| canonical_subject_similarity_suggestion | 78 |
| **canonical_subject_links** | **0** |
| subject_thread_links | 51 |
| site_actions liées à un thread | 52 |
| Journaux `canonical_subject_merge` du site | 82 |

Le détail par CS (occurrences, threads, proposals, actions, dates) est dans `audit-p15a-inventory.clean.json → activeSubjects`.

**Écarts notables vs audit précédent (~19 CS)** : la base réelle compte **131 CS actifs hors acteurs**, bien au-delà des ~19 identifiés. La séparation historique est plus étendue que supposé.

**Finding rollback (§11)** : 268 CS sont marqués `merged` mais seulement **82 journaux** `canonical_subject_merge` existent → **~186 fusions historiques sans trace de journal** (fusions antérieures au journal ou via scripts de dédup n'ayant pas tous écrit le snapshot).

---

## 2 — Génération et classification des candidats

Mécanisme strictement réutilisé de P0-1/P0-2 :
`normalizeForMatching()` → Jaccard ≥ 0.35 (`P01_NORMALIZED_JACCARD_THRESHOLD`) → `analyzeSubjectPair()`.

**53 paires candidates** générées entre les 131 CS actifs. Verdicts P0-2 : 5 réutilisés des paires validées, 1 garde acteur déterministe, 47 évalués via Gemini (paires non couvertes par les 22 paires connues — Gemini supplémentaire justifié car les verdicts existants ne couvraient pas ces paires).

| Classe | Nombre |
|---|---|
| `SAFE_SAME` (same_subject, conf ≥ 85) | **40** |
| `RELATED_NOT_SAME` (related) | 11 |
| `DISTINCT` (distinct ou conf < 60) | 2 |
| `UNCERTAIN` | **0** |

Tableau complet (label A / label B / familles / occ / normalized / jaccard / verdict / conf / reason / source) : `audit-p15a-classify.clean.json → rows`.

**Garde acteur COLL-5** : `M. DEVALLEZ ↔ G. DEVALLEZ` (J=1.0) forcé `DISTINCT` — deux personnes distinctes, jamais fusionnées automatiquement. (Le premier passage d'une heuristique trop large avait faussement capté `GDE - Fossé ↔ Fossé GDE` ; heuristique resserrée à civilité/initiale-pointée, cette paire repart en Gemini et ressort SAME correctement.)

---

## 3 — Les deux BORDER obligatoires

Les libellés exacts des paires BORDER de la doc P0-2 ("Démarrage purge", "GNT sur plateforme") sont des **labels de test**, pas des CS actifs verbatim. Ils correspondent en réalité à deux **familles de CS** :

### BORDER 1 — territoire « purge de plateforme »

CS actifs concernés :
| CS | id | occ | threads |
|---|---|---|---|
| Réalisation Purge Plateforme | 43e59642 | 1 (2026-02-12) | 3 |
| Démarrage purge plateforme | 78e477a2 | 0 | 3 |
| Terrassement plateforme : Démarrage purge | 9192db79 | 0 | 1 |
| Purge de la plateforme | 4fd2f51a | 0 | 2 |

Verdicts P0-2 internes :
- `Purge de la plateforme` ↔ `Réalisation Purge Plateforme` = **same_subject (95)**
- `Démarrage purge plateforme` ↔ `Réalisation Purge Plateforme` = **same_subject (95)**
- `Terrassement plateforme : Démarrage purge` ↔ `Démarrage purge plateforme` = **same_subject (98)**
- **`Purge de la plateforme` ↔ `Démarrage purge plateforme` = related (85)** ← edge directement RELATED
- `Purge de la plateforme` ↔ `Terrassement plateforme : Démarrage purge` = **pas d'arête directe** (transitive uniquement)

**Conséquence d'une fusion** : la clôture transitive sur les arêtes SAME agrège dans une même grappe des CS dont une paire directe est jugée **RELATED** (démarrage ≠ réalisation = phases distinctes, doctrine cycle-de-vie). La ligne de vie fondrait deux phases successives en un seul sujet, perdant la distinction démarrage→réalisation.

**Verdict BORDER 1 : `HUMAN_REVIEW_REQUIRED`.**

### BORDER 2 — territoire « couche de forme / GNT / accès plateforme »

CS actifs concernés :
| CS | id | occ | threads |
|---|---|---|---|
| Mise en place couche de forme (GNT) | d9bb24b2 | 6 | 4 |
| Mise en place de la couche de forme | 949cb00d | 0 | 2 |
| Prévision : Mise en place couche de forme | 7f684dad | 0 | 1 |
| Couche de forme Accès Plateforme | 3355e3d4 | 5 | 1 |

Verdicts P0-2 internes :
- `Mise en place de la couche de forme` ↔ `Mise en place couche de forme (GNT)` = **same_subject (95)**
- `Mise en place de la couche de forme` ↔ `Prévision : Mise en place couche de forme` = **same_subject (95)**
- **`Mise en place couche de forme (GNT)` ↔ `Prévision : Mise en place couche de forme` = related (85)** ← edge directement RELATED (prévision vs réalisation)
- `Couche de forme Accès Plateforme` ↔ tous les autres = **related (75-80)** → **correctement exclu** de la grappe (jamais fusionné).

Le cas « Couche de forme Accès Plateforme ↔ GNT sur plateforme » de la doc P0-2 (localisation accès vs plateforme globale) est **résolu proprement** : `Couche de forme Accès Plateforme` reste un CS séparé (toutes ses arêtes sont RELATED). Le danger réel restant est l'arête interne prévision↔réalisation dans la grappe GNT.

**Verdict BORDER 2 : `HUMAN_REVIEW_REQUIRED`** (arête prévision/réalisation non-transitive à l'intérieur de la grappe couche de forme).

---

## 4 — Règle de choix du survivor (déterministe)

Ordre lexicographique de départage, appliqué à chaque grappe :

1. **status ≠ 'merged'** (toujours vrai ici : grappes de CS actifs)
2. plus grand **nombre d'occurrences**
3. plus grand **nombre de threads**
4. **firstOcc le plus ancien** (à défaut d'occurrence : `created_at` le plus ancien)
5. **id lexicographique** (stabilité déterministe finale)

Le survivor **conserve son UUID**. Les losers reçoivent théoriquement `merged_into = survivor.id` + `status='merged'`.

---

## 5 — Simulation occurrence par occurrence

- **Occurrences déplacées** (losers → survivor) : **6** au total sur toutes les grappes.
- **Doublons d'occurrence détectés : 0.**

Aucune collision sur la contrainte d'unicité `(source_kind, source_proposal_id)` de `canonical_subject_occurrence` : les occurrences historiques portent `source_proposal_id = null` (le lien passe par le thread), et aucune paire (source_kind, source_ref_id, label) identique n'est présente chez un survivor et un loser simultanément. Chaque occurrence déplacée est une **preuve distincte sur une visite/date différente** — aucun doublon technique.

Détail des moves par grappe : `audit-p15a-simulate.clean.json → clusters[].occMoves / duplicateOccurrences`.

---

## 6 — Recalcul longitudinal théorique

`firstSeenAt` / `lastSeenAt` / `lastMeaningfulChangeAt` ne sont **jamais persistés** : ils sont **dérivés à la lecture** par `getCanonicalSubjectLife()` / `getNavigableSubjectsForSite()` (`lib/db/canonical-subject-life.ts`), à partir de la timeline fusionnée des occurrences (signature = statut + signature d'objets matérialisés par run).

Conséquence : la fusion **ne détruit aucune donnée nécessaire au recalcul**. Après fusion :
- `firstSeenAt` = min réel des occurrences de toute la grappe (calculé, colonne `firstSeenTheoretical`).
- `lastSeenAt` = max réel (colonne `lastSeenTheoretical`).
- `lastMeaningfulChangeAt` = **`LMCA_RECALC_SAFE`** pour les 17 grappes : il sera recalculé automatiquement à la prochaine lecture, sur la timeline fusionnée. Aucune valeur fabriquée.

Valeurs théoriques par grappe : `audit-p15a-simulate.clean.json → clusters[].firstSeenTheoretical / lastSeenTheoretical / lmca`.

Aucune grappe `LMCA_RECALC_UNSAFE`.

---

## 7 — Impact sur les relations sujet↔sujet

- **`canonical_subject_links` : 0 lien sur tout le site OCEF** → 0 relation CS-niveau à rerouter, **0 self-link produit**, 0 conflit. Le point d'architecture (le merge SQL 311 et `mergeCanonicalSubjectsAction` ne reroutent PAS `canonical_subject_links`) **n'a aucun impact sur OCEF** faute de données, mais reste un **gap d'architecture** à combler avant toute mutation sur un site qui en possède (voir §11).
- **`subject_thread_links` (51 sur le site)** : les liens sont au niveau **thread**. La fusion déplace les threads (`subject_thread_identity`) vers le survivor ; les liens suivent donc automatiquement **sans reroutage**. **8 liens touchés**, **0 self-link** produit (aucune grappe n'a deux threads reliés entre eux). Le read-model `CanonicalLink` déduplique déjà les liens intra-CS.

Aucune relation humaine confirmée n'est perdue.

---

## 8 — Impact sur les suggestions de similarité

Sur 78 `canonical_subject_similarity_suggestion` : **63 deviennent obsolètes** après fusion théorique (une ou deux extrémités devenant un loser, ou paire devenant triviale A=A). Ce n'est **pas une perte** : `filterActiveSuggestions()` (`lib/subjects/similarity-analyze.ts`) marque déjà automatiquement `obsolete` toute suggestion dont une extrémité n'est plus active ou dont les deux extrémités résolvent vers le même canonical. Les décisions humaines (`accepted_*`, `rejected`) sont protégées par `upsertSuggestion()` (non écrasées). Aucune adaptation requise.

---

## 9 — Impact downstream

| Lecteur | Impact fusion | Risque | Adaptation |
|---|---|---|---|
| `getNavigableSubjectsForSite` | Recalcule tout à la lecture par CS actif ; losers disparaissent (status='merged' filtré) | Nul | Aucune |
| `getCanonicalSubjectLife` / Subject Lifeline | Timeline fusionnée dérivée ; merged→redirection via `merged_into` | Nul | Aucune |
| Attention / stagnation | Dérivé de la timeline fusionnée (statut + matSig) | Nul | Aucune |
| Visit Briefing / préparation | Consomme les read-models ci-dessus | Nul | Aucune |
| Knowledge / Dependency Graph | Lit `subject_thread_links` (thread-niveau, suit les threads) + `canonical_subject_links` (0 sur OCEF) | Nul sur OCEF | Reroute CS-links requis pour sites avec liens (§11) |
| Résultat import / rapprochements | Lit suggestions actives (auto-filtrées) | Nul | Aucune |

Aucun lecteur ne code d'hypothèse implicite sur les IDs des losers : tous filtrent `status='active'` ou redirigent via `merged_into`. La re-canonicalisation ne casse pas de contrat de lecture.

---

## 10 — Idempotence

Second passage théorique de P0-1/P0-2 sur la DB résultante (survivants + CS non regroupés) :

- **0 nouvelle fusion** : les 9 paires résiduelles ≥ 0.35 sont toutes **non-SAFE_SAME** (RELATED ou DISTINCT) — P0-2 les re-rejette systématiquement.
- 0 occurrence déplacée, 0 relation modifiée, 0 timestamp changé.

**Nuance importante** : la **décision** est idempotente (aucun nouveau merge au 2ᵉ passage), mais la **génération de candidats P0-1** ne l'est pas : les 9 mêmes paires (ex. `Accès Plateforme - Travaux réalisés ↔ Accès Plateforme` J=1.0 RELATED ; `M. DEVALLEZ ↔ G. DEVALLEZ` J=1.0 DISTINCT) sont re-proposées à chaque passage. Le filtrage repose entièrement sur P0-2, jamais sur P0-1.

**Verdict : `IDEMPOTENT` au niveau des mutations** (le seul niveau qui engage l'intégrité des données). Cause du résidu P0-1 : par conception, dates/objets restent dans la forme normalisée (doctrine P0-1 §29), donc RELATED et DISTINCT co-apparaissent au-dessus du seuil et ne sont éliminés que par P0-2.

---

## 11 — Rollback / traçabilité

Table existante : `canonical_subject_merge` (mig 304) + snapshot JSONB (`moved_thread_ids`, `moved_occurrence_ids`, `winner_label_before`, `winner_aliases_before`, `loser_label`, `loser_aliases`).

**Suffit pour** : survivor, loser, occurrences/threads déplacés, ancien label/aliases du winner et du loser, source, timestamp.

**Ne suffit PAS / à combler avant mutation** :
1. **`canonical_subject_links` non rerouté ni snapshoté** — ni le merge SQL 311 ni `mergeCanonicalSubjectsAction` ne touchent cette table ; le snapshot ne trace pas les liens CS-niveau reroutés. Sans impact sur OCEF (0 lien) mais **gap réel** pour tout site avec liens.
2. **Version du moteur absente du journal** — pas de colonne `engine_version` / `p01_p02_version` pour attribuer une fusion à une révision du moteur.
3. **Cause structurée absente** — `llm_reasoning` est libre ; pas de champ `classification` (SAFE_SAME) ni `jaccard` ni `confidence` normalisés.
4. **186 fusions historiques sans journal** (268 merged vs 82 journaux) → un rollback global du stock actuel serait partiellement aveugle. Nouvelle re-canonicalisation P1-5 : exiger un journal pour **chaque** move.

Aucune migration créée pendant P1-5A (conforme au périmètre).

---

## 12 — Réextraction future

Scénario : un ancien PV est réextrait après re-canonicalisation.

- **Retrouve le survivor ?** Oui : `normalizeForMatching(label)` du PV réextrait matche le survivor par Jaccard ≥ 0.35 (le survivor porte le label le plus représentatif de sa grappe et absorbe les alias des losers via l'étape 10 de `mergeCanonicalSubjectsAction`).
- **Risque de recréer un loser ?** Non pour un loser dont le label est devenu un alias du survivor. **Oui résiduel** pour une formulation nouvelle qui matcherait un loser `merged` : la résolution doit **suivre `merged_into`** vers le survivor (à vérifier dans le resolver de production `canonical-subject-resolve.ts` avant branchement).
- **Duplication d'occurrence ?** Empêchée par `(source_kind, source_proposal_id)` unique pour les occurrences terrain. Pour les occurrences historical_pdf (`source_proposal_id=null`), l'idempotence repose sur le pipeline historique existant (thread), pas sur cette contrainte — à confirmer côté réextraction.
- **Distinguer nouvelle preuve / preuve connue** : par `source_ref_id` (run/report) + `effective_date`. Une même date + même run = preuve déjà connue.

---

## 13 — Métriques du dry-run

| Métrique | Valeur |
|---|---|
| CS actifs (hors acteurs) avant | 131 |
| CS actifs après (théorique) | **102** |
| Paires candidates | 53 |
| SAFE_SAME / RELATED / DISTINCT / UNCERTAIN | 40 / 11 / 2 / 0 |
| Grappes SAFE_SAME (union-find) | 17 |
| — grappes internes cohérentes (auto-fusion sûre) | **15** |
| — grappes contaminées (arête RELATED interne) | **2** |
| CS losers théoriques | 29 |
| Occurrences déplacées | 6 |
| Doublons d'occurrence potentiels | **0** |
| canonical_subject_links reroutés / self-links éliminés | 0 / 0 |
| subject_thread_links touchés / self-links | 8 / 0 |
| Suggestions rendues obsolètes | 63 |
| HUMAN_REVIEW_REQUIRED (grappes) | 2 (purge, couche de forme GNT) |
| LMCA recalculables / non recalculables | 17 / 0 |
| Paires résiduelles P0-1 après fusion (2ᵉ passage) | 9 (toutes re-rejetées par P0-2) |

---

## 14 — Grappes (AVANT / OPÉRATION / APRÈS)

Les 17 grappes complètes (membres, survivor+raison, losers, moves, first/last théoriques, relations) sont dans `audit-p15a-simulate.clean.json → clusters`. Synthèse :

**15 grappes CLEAN (SAFE_SAME interne complet)** — candidates à re-canonicalisation contrôlée :
Coordination LOT01/LOT02 (4 CS) · Transmission fiches techniques (2) · Journal de chantier (2) · GDE-Fossé (3) · GDE-Busage Provisoire (3) · Transmission relevés météo (3) · Accès Plateforme - Travaux réalisés (2) · BECIB interlocuteur lot 01 (3) · Plan de gestion des eaux pluviales (3) · Moyens matériels sur site (4) · Terrassement Plateforme Déblais/Remblais (2) · Reprise accès sortie (2) · Propreté des abords (2) · Visite mairie secteur (2) · Transmission Rapport/CR Visite Mairie (2).

**2 grappes CONTAMINÉES → HUMAN_REVIEW_REQUIRED** :
- **Réalisation Purge Plateforme** (4 CS) — arête interne `Purge de la plateforme ↔ Démarrage purge plateforme = related (85)` + 2 paires transitive-only. Fusionne démarrage et réalisation (phases distinctes).
- **Mise en place couche de forme (GNT)** (3 CS) — arête interne `GNT ↔ Prévision = related (85)`. Fusionne prévision et réalisation (distinction cycle-de-vie).

---

## 15 — Verdict final

### **`HUMAN_REVIEW_REQUIRED`**

Justification (architecture saine, quelques grappes seulement empêchent l'automatisation totale) :

- **Positif** : 15/17 grappes sont internes-cohérentes SAFE_SAME, 0 doublon d'occurrence, 0 self-link, 0 canonical_subject_links à casser sur OCEF, LMCA intégralement recalculable, mutations idempotentes, aucun lecteur downstream ne casse.
- **Bloquant pour l'automatisation intégrale** :
  1. **2 grappes contaminées** par une arête directe RELATED (purge : démarrage↔réalisation ; couche de forme : prévision↔réalisation). La clôture transitive sur SAME agrège des CS que P0-2 a directement jugés distincts → **ne jamais auto-fusionner** ; réserver à décision humaine.
  2. **Gap de traçabilité** (§11) : `canonical_subject_links` non rerouté/snapshoté par le chemin de merge, absence de version moteur et de cause structurée dans le journal, 186 fusions historiques sans journal.

### Chemin recommandé (hors périmètre P1-5A — aucune action prise)

1. Restreindre l'auto-fusion aux **grappes internes-cohérentes** : rejeter toute grappe contenant une arête directe non-SAFE_SAME ou une paire transitive-only sans arête directe (validation par matrice de paires, pas par union-find seul).
2. Router les 2 grappes contaminées vers revue humaine (démarrage/réalisation, prévision/réalisation).
3. Avant toute mutation : combler le gap `canonical_subject_links` (reroute + snapshot) et ajouter version moteur + cause structurée au journal.

**HARD STOP** — fin du run P1-5A. Aucune mutation exécutée.
