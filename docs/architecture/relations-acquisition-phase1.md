# Lot Relations — acquisition automatique · Phase 1 (audit court avant code)

**Statut : ANALYSÉ + PRÉCISION PROUVÉE (recette). HARD STOP avant toute écriture automatique en prod.**
**Cap produit : David ne construit pas les dépendances ; MemorIA les apprend de la matière (PV/CR/visite),
les source, et lui laisse le droit de corriger.**

---

## 1. Trace du moteur `produceRelationsFromOccurrences` (lib/ai/produce-relations-from-occurrences.ts)

| Élément | Constat |
|---|---|
| **Signature** | `({ siteId, admin, dryRun?, triggerVisitId?, configOverride? }) → ProduceRelationsFromOccurrencesResult` |
| **Inputs** | `canonical_subject` (status='active'), `canonical_subject_occurrence` (source_kind ∈ field_visit, meeting, historical_pdf) |
| **Sélection paires** | co-occurrence par `source_ref_id` (visite/PV) → paires ; filtres `minCooccurrences=3`, `minLift=1.5` ; tri score combiné ; **top `maxCandidatesPerRun=10`** |
| **Prompt LLM** | `qualifyLinkCandidate` (Gemini light, temp 0) : juge UNE paire + preuves ; doctrine anti-cooccurrence / anti-contingence explicite |
| **Whitelist** | serveur strict `{requires, enables, validates, causes, replaces}` ; **`relates_to` REJETÉ avant INSERT** (compté `relatesTo`, jamais écrit) |
| **Confidence** | `minLlmConfidence=0.70` ; sous le seuil → skip |
| **evidence_text** | OBLIGATOIRE (NOT NULL) ; `skippedNoEvidence` si aucun extrait ; écrit dans `canonical_subject_link_evidence` |
| **source_ref** | `evidence_run_id` sur le lien ; `occurrence_id` + `source_proposal_id` sur l'evidence |
| **status** | `'suggested'` toujours (jamais confirmed) |
| **Idempotence (écritures)** | ✅ paires existantes exclues (`excludedPairs` depuis `canonical_subject_links`) + contrainte UNIQUE paire normalisée (23505 ignoré) |
| **Doublons** | gérés (exclusion + unique + code 23505) |
| **Guard same_subject** | score ≥ 3 → skip (log) |
| **Relation inverse** | direction résolue A_to_B / B_to_A depuis le LLM ; une seule arête par paire |

---

## 2. DEUX correctifs REQUIS avant branchement (bloquants pour le wiring, pas pour la précision)

### 2.1 — `triggerVisitId` casse la sélection incrémentale (BUG)
`if (triggerVisitId) occurrencesQuery.eq('source_ref_id', triggerVisitId)` restreint le **fetch** aux
occurrences de cette seule visite → `N = 1 visite` → `if (N < minCooccurrences) return` → **0 relation**.
Le `subjectsInTriggerVisit` censé filtrer les candidats devient mort. Correctif : charger TOUTES les
occurrences (historique de co-occurrence) puis restreindre les **candidats** aux paires touchant les sujets
du run — exactement le motif de `produceRelationsForRun` (legacy) qui, lui, est correct.

### 2.2 — Exclusion des acteurs ABSENTE
Le moteur charge `canonical_subject` **sans filtre de kind** et code en dur `famA/famB='observation'`.
Aucun appel à `getActorCanonicalIds` (kind durable, mig 355 #228) ni à `excludedFamilies`. → Un acteur
(entreprise/personne) ayant des occurrences pourrait devenir candidat. Correctif OBLIGATOIRE (doctrine :
acteurs exclus ; Phase 9 : 0 acteur par erreur) : exclure les canonical_subject de kind `actor` du pool.

---

## 3. Points de branchement dans le workflow

### 3.1 — PV / CR (tracé)
`review-actions.ts:1141` appelle aujourd'hui `produceRelationsForRun` (→ `subject_thread_links` legacy,
qui écrit `relates_to`), en best-effort après le pipeline knowledge. Chaîne :
`import → extraction → review → canonicalisation → after(runHistoricalMemoryBuildPipeline) →
ensureHistoricalPdfOccurrences → [ICI] produceRelationsFromOccurrences`.
Branchement cible = **remplacer** l'appel `produceRelationsForRun` par `produceRelationsFromOccurrences`
(après matérialisation des occurrences, identité canonique établie). Jamais avant l'identité canonique.

### 3.2 — Visite terrain (principe confirmé, call site à pointer en Phase 5)
Le moteur lit déjà `source_kind='field_visit'`. Donc **le même moteur s'applique** dès que les occurrences
de visite sont matérialisées. Le call site exact (après matérialisation des occurrences de visite) reste à
pointer précisément lors de l'implémentation — pas de moteur terrain séparé (la primitive occurrence-first suffit).

### 3.3 — Même moteur PV/CR/visite : ✅ oui (canonical_subject_occurrence multi-source_kind).

---

## 4. Coût & bornage
- **LLM borné** : ≤ `maxCandidatesPerRun=10` appels Gemini par run (top-N après filtres statistiques).
- **Calcul de paires** : O(paires) par visite ; sur OCEF (67 sujets, 1690 paires) → négligeable.
- **NON incrémental aujourd'hui** (cf. 2.1) : recalcule tout le site à chaque appel sans triggerVisitId.
  À corriger pour ne traiter que « sujets touchés par le run × candidats plausibles », pas N² global.
- **`no_relation` non caché** : re-évalué à chaque run → coût LLM répété sur les mêmes paires stériles.
  Observabilité (Phase 10) à brancher sur `ai_usage`/logs existants avant d'industrialiser.

---

## 5. Précision — RECETTE (le verrou empirique) — `scripts/recette-relations-precision.ts`
Juge relationnel exercé directement (Gemini temp 0) sur 8 paires synthétiques contrôlées :

| Cas | Attendu | Verdict Gemini | OK |
|---|---|---|---|
| élec après validation plans | directionnel | **requires (A→B)** conf 0.90 | ✅ |
| mise en service cuisine ← NC élec | directionnel | **requires** 0.90 | ✅ |
| hotte ← alim élec | directionnel | **requires** 0.90 | ✅ |
| 2 sujets même phrase (tous réalisés) | pas de FP | relates_to → **rejeté whitelist** | ✅ |
| 2 contrôles même domaine | pas de FP | relates_to → rejeté | ✅ |
| même acteur / 2 sujets | pas de FP | relates_to → rejeté | ✅ |
| même localisation | pas de FP | relates_to → rejeté | ✅ |
| « concernant » vague | pas de FP | relates_to → rejeté | ✅ |

**0 faux positif, 0 faux négatif.** Enseignement clé : Gemini penche vers `relates_to` pour la cooccurrence
(pas `no_relation`) — c'est la **whitelist serveur** qui transforme cela en non-écriture. Le filet de sécurité
est donc le rejet `relates_to`, pas le verdict LLM seul. Confirme la doctrine et le dry-run OCEF antérieur
(1690 paires → 0 relation écrite).

---

## 6. Verdict Phase 1
Le moteur est **précis** (0 FP prouvé), **borné en LLM** (≤10/run) et **idempotent en écriture**. Il n'est
PAS branchable en l'état : deux correctifs obligatoires (§2.1 sélection incrémentale, §2.2 exclusion acteurs)
avant toute écriture automatique en prod. La décision de brancher reste empirique et se prouvera une fois le
moteur câblé au vrai workflow (dry-run sur run réel), pas seulement en synthétique.

**Séquence proposée (inchangée) :** corriger §2.1+§2.2 → dry-run run réel (Bella/OCEF/PETRO) → recette →
brancher PV/CR (remplacer produceRelationsForRun) → brancher visite → fiche sujet légère si backend sûr.
**HARD STOP ici (avant écriture automatique en prod). Attends le GO.**

Gelé : aucune vue globale / graphe / drag & drop ; onglet Dépendances masqué ; pas de backfill legacy ;
les 51 subject_thread_links fixture et le lien PETRO de test ne deviennent pas vérité métier.
