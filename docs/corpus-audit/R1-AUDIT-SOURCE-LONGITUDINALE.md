# R-1 — Audit READ-ONLY : convergence de la restitution longitudinale vers `canonical_subject_occurrence`

Date : 2026-08-28. Aucun write. Objectif : établir **une seule vérité longitudinale**. Aujourd'hui la
restitution historique reconstruit une **seconde vérité** depuis les propositions ; le modèle
d'occurrences atomiques (D1+D2, backfillé) n'est pas lu pour l'historique.

## 0. Preuve sur données réelles (éclairage Bella, `scripts/audit-r1-divergence.ts`)

| | Ce qui est représenté |
|---|---|
| **Occurrences atomiques** | `knowledge_fact` « réalisé » position **2024-03-22** · `action` « à refaire » position 2025-08-05 → **témoin ✅** |
| **Reconstruction Ligne de vie** | 1 primaire/run : `action` gagne (rang 1 < knowledge_fact rang 5) ; le fait daté devient un `additionalLabel` **sans position ni date** → **témoin ❌** |

C'est structurel, pas un cas Bella : toute paire d'états de familles distinctes dans un même document
subit la même perte.

## 1. Les deux sources, aujourd'hui

**Reconstruction propositions** — `getCanonicalSubjectLife`, branche historique (l.402-534 de
`canonical-subject-life.ts`) : lit `document_extraction_proposal` groupée **par run**, **1 occurrence
par run**, proposition primaire choisie par **rang de famille**, secondaires aplaties en
`additionalLabels`. `canonical_subject_occurrence` n'est lu QUE pour `field_visit`/`meeting` (l.640).

**Occurrences atomiques** — `canonical_subject_occurrence` (`source_kind='historical_pdf'`, écrites par
`ensureHistoricalPdfOccurrences`) : **N occurrences par (sujet, document)**, une par `state_key`, avec
`event_date`, dédup same-state, liens acteur (rôle).

**Incohérence de fond** : la même timeline d'un sujet est bâtie sur **deux tables différentes** selon la
source — terrain depuis les occurrences, historique depuis les propositions.

## 2. Inventaire par dimension (checklist Vincent)

| Dimension | Reconstruction propositions | Occurrence atomique | Convergence |
|---|---|---|---|
| **Granularité** | 1 état/run (primaire) | **N états/document** | occurrence gagne |
| **Date propre du fait** | absente | **`event_date`** | occurrence gagne |
| **Position temporelle** | date du PV | `COALESCE(event_date, effective_date)` | occurrence gagne |
| **Tri-state resolved/open/unknown** | dérivé de `document_status` | ⚠️ **`document_status` NON stocké** | **à résoudre (§3)** |
| **Transitions** (`computeHistoryTransition`) | calculées inter-run | non stockées | **recalculables** depuis occurrences + axe runs |
| **Gaps `non_mentionné`** | runs sans proposition | non stockés | **recalculables** (axe `canonicalRunsForSite`) |
| **Famille** | `proposal_family` | `state_key` (= famille) | équivalent |
| **thematic_category** | présent | non stocké | ⚠️ métadonnée à porter |
| **source_page** | présent | non stocké | ⚠️ provenance d'affichage à porter |
| **Preuves** | count `document_proposal_evidence`/prop | `evidence_count` = **taille du pool** | ⚠️ **sémantique différente** |
| **Objets matérialisés** (action/décision/réserve/échéance) | join `proposalIds → document_proposal_materialization` | `source_proposal_id` = **null** | **à résoudre (§3)** — join par (sujet, run) |
| **run_id / document_id** | présent | occurrence porte `source_ref_id` (report), pas le run | mapping report↔run requis |
| **Acteurs (rôle)** | absent de la Ligne de vie | **liens `..._actor_link`** (mig 356) | occurrence gagne |
| **lastSeen** | max(effective_date) | idem | identique (event_date n'y touche pas) |
| **Provenance PV** | run/document | `source_ref_id` + `effective_date` | équivalent — témoin OK |
| **Ordre intra-document** | inexistant (1/run) | par `event_date`, sinon indéfini | ⚠️ **tie-break ex-æquo à définir** |

## 3. Ce que le refactor doit trancher (points durs)

1. **Tri-state (P1-3) — le plus important.** L'occurrence porte `state_key` (= famille) mais **pas
   `document_status`**. Or `documentStatusToPvState` dérive resolved/open/unknown de `document_status`.
   Basculer naïvement sur les occurrences **perdrait** le tri-state.
   → Option recommandée : **colonne additive** `document_status` (ou un `doc_state` tri-state figé) sur
   `canonical_subject_occurrence`, renseignée à l'écriture depuis le pool (le meilleur statut de l'état).
   Alternative rejetée : lecture hybride (occurrences pour la multiplicité + propositions pour le
   statut) — reconduit la double source qu'on veut supprimer.

2. **Objets matérialisés.** `source_proposal_id` est null → pas de join direct. Les occurrences portent
   `source_ref_id` (report) ; `document_proposal_materialization` se joint par `proposal_id`.
   → Reconstruire le lien par **(canonical_subject_id, run)** via le mapping report↔run (déjà
   disponible), sans réintroduire les propositions comme source de vérité de la timeline.

3. **Métadonnées d'affichage** (`thematic_category`, `source_page`) : additives sur l'occurrence, ou
   assumées non essentielles à la Ligne de vie. À décider (faible risque).

4. **Preuves** : aligner la sémantique (`evidence_count` du pool ≠ nb de `document_proposal_evidence`).
   Décision : garder le pool (nb d'états poolés) OU recompter les preuves réelles. Faible enjeu.

5. **Tie-break ex-æquo** : ordre déterministe des états d'un même document à date égale (ex. famille
   puis label). À figer pour un rendu stable.

## 4. Périmètre de convergence (proposition)

- **Point unique de vérité** : `getCanonicalSubjectLife` lit `canonical_subject_occurrence` pour
  l'historique comme pour le terrain (une seule table). Transitions/gaps restent **dérivés** (calcul,
  pas seconde vérité) depuis occurrences + axe `canonicalRunsForSite`.
- **Migration additive** (Niveau 3) : porter sur l'occurrence historique le statut nécessaire au
  tri-state (+ éventuellement thematic_category/source_page), renseigné par `ensureHistoricalPdfOccurrences`.
- **Non-régression** : `tests/lib/canonical-subject-life.test.ts` + recette témoin éclairage + parité
  avant/après sur Bella (occurrences, transitions, gaps, LMCA, lastSeen, stagnation) — **aucun sujet ne
  doit perdre d'information** vs l'état actuel.
- **Consommateurs** (tous via `getCanonicalSubjectLife`) : pages sujet desktop
  `historique/sujets/[id]`, mobile `/m/site/[siteId]/sujets/[id]`, `services/ai/canonical-subject-trajectory.ts`,
  `lib/visits/copilot-free-prepare.ts`. Corriger la fonction corrige les surfaces.

## 5. Critère témoin (inchangé)

La Ligne de vie éclairage doit raconter : **22/03/2024 — contrôle réalisé**, puis **05/08/2025 — à
refaire**, les deux tracés au PV du 05/08/2025. Tant que ce n'est pas le cas à l'écran, R-1 n'est pas
fini.

## 6. Verdict & recommandation

- La divergence est **réelle, structurelle et prouvée**. Le modèle d'occurrences est le bon socle.
- R-1 **n'est pas un simple changement de requête** : il exige une **migration additive** (au minimum le
  statut pour préserver le tri-state) + réécriture de la branche historique + reconstruction du lien
  matérialisations par (sujet, run). C'est un lot **Niveau 3** sur un read-model critique.
- **HARD STOP** avant d'écrire : décision requise sur le point dur §3.1 (colonne de statut sur
  l'occurrence vs autre stratégie) avant tout code, car il conditionne la migration.
