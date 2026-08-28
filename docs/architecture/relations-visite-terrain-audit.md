# Relations — visite terrain · Audit + dry-run (READ-ONLY, avant activation)

**Statut : ANALYSÉ. Aucune écriture, aucun code produit modifié, moteur PV/CR actif NON touché. HARD STOP.**
**Verdict : B — précision sûre, mais RECALL structurellement nul via cooc≥3 ; brancher la visite en l'état
produirait exactement 0 relation. Le déblocage réel = voie « preuve explicite forte » (à concevoir, pas à coder).**

---

## Phase 1 — Workflow réel de la visite & point d'appel candidat

`visite terrain → debrief (vocal/texte/photo) → propositions (site_knowledge_proposals) →
reconcileSourceToCanonicalSubjects({ type:'field_visit', id: reportId }) → canonical_subject_occurrence(field_visit)`

Point d'appel identifié : **`lib/visits/debrief-analysis.ts`**, après `reconcileSourceToCanonicalSubjects`
(l.465) + `autoArchiveOrphanedSubjects` + `projectCanonicalSubjectSafely` (l.482), avant l'update
`canonical_reconciled_at`. C'est là que **toutes** les occurrences de la visite sont définitivement disponibles.
`triggerVisitId = reportId`. Couvre import initial, modification du CR (re-reconcile) et retry (même chemin) ;
idempotence garantie par le soft-lock `acquireReconcileLock` + `onConflict:'source_kind,source_proposal_id'`.
Échec IA du debrief → aucune occurrence → aucun appel relations (sûr).

---

## Phase 2 — Preuve réellement disponible pour le juge

Une occurrence `field_visit` porte : `label` = titre de la proposition, `note` = corps de la proposition
(`site_knowledge_proposals.title/body`), + `source_proposal_id`, `source_ref_id` (reportId), `effective_date`,
`entity_ids`. Le juge reçoit donc **label + note** comme evidence — déjà une extraction structurée, pas la
dictée brute.

**Qualité mesurée (92 occurrences field_visit, tout le dépôt)** : ~la moitié **sans note** ; longueur moyenne
de note ≈ **53 caractères** (PETRO). La matière est courte et souvent réduite au seul label.

---

## Phase 3 — Risque « proximité ≠ preuve » (spécifique visite)
Déjà couvert par le juge durci (règle « preuve ENTRE les deux sujets », contexte partagé ≠ dépendance). Mais
le point est **théorique ici** : aucun candidat n'atteint le juge (Phase 4). La garde existe si un jour des
candidats visite émergent.

---

## Phase 4 — cooc≥3 ne convient pas à la visite (mesuré, aucun seuil changé)
Le préfiltre exige qu'une paire de sujets co-apparaisse dans **≥ 3 sources** (visites/réunions/PV confondus).
**Résultat mesuré : 0 paire `field_visit` atteint cooc≥3 sur AUCUN site.** Une dépendance énoncée dans **une
seule** visite (cooc=1) ne devient jamais candidate. Les visites ne contribuent aujourd'hui que si la même
paire réapparaît ≥3 fois ailleurs (PV) — auquel cas c'est le PV, déjà actif, qui la porte.

| Site | occ field_visit | visites | sujets | paires cooc≥3 (field_visit) |
|---|---|---|---|---|
| PETRO | 71 | 9 | 16 | **0** |
| OCEF prod 06c62e48 | 7 | 3 | 3 | **0** |
| autres (6 sites) | 1–5 | 1–2 | 1–5 | **0** |

---

## Phase 5 — Dry-run visite (PETRO, la plus fournie) — AUCUNE écriture
`produceRelationsFromOccurrences({ siteId: PETRO, triggerVisitId: <visite la + récente>, dryRun })` :
**totalPairs=33 · candidats évalués=0 · appels LLM=0 · suggested=0 · acteurs pool=0.**
→ Brancher la visite avec la sélection actuelle produirait **exactement 0 relation**. C'est le non-résultat
« 0 faux positif parce que 0 relation » que tu as explicitement refusé comme suffisant.

---

## Phase 6 — RECALL (le point neuf) — mesure sur la matière réelle
Marqueurs de dépendance explicite (`dépend/nécessite/impossible tant que/avant/après validation/bloque/permet…`)
dans la matière field_visit : **2 occurrences sur 92**. Et les deux sont des liens **sujet → action**
(« Absence de jus au TD — Nécessite une vérification par l'électricien »), PAS des dépendances
**sujet ↔ sujet** que `canonical_subject_links` capture. → **Recall réel de dépendances sujet↔sujet dans le
corpus visite actuel ≈ 0.** (Référence : historical_pdf = 10/522 marqueurs — les PV en portent, les visites quasi pas.)

Double enseignement : (1) même sans cooc≥3, la matière visite actuelle ne contient presque aucune dépendance
sujet↔sujet explicite ; (2) quand une dépendance est exprimée, c'est souvent sujet→action (hors modèle actuel).

---

## Phase 7 — VERDICT : **B (+ condition amont)**
- **Précision** : sûre (0 candidat → 0 faux positif possible depuis la visite).
- **Recall** : structurellement **nul** — cooc≥3 exclut toute dépendance dite une seule fois en visite, et le
  corpus visite actuel ne contient de toute façon quasi aucune dépendance sujet↔sujet explicite.
- **Conclusion** : **NE PAS brancher la visite avec la sélection cooc≥3** (produirait 0, sans valeur). La valeur
  n'apparaîtra qu'avec une **seconde voie**.

### Design proposé (À NE PAS CODER dans ce lot) — voie « preuve explicite forte »
Deux voies convergeant vers **le même juge conservateur** :
1. *Voie implicite (actuelle)* : cooccurrence répétée ≥3 → candidat → juge. (inchangée)
2. *Voie explicite (nouvelle)* : une **occurrence unique** (PV ou visite) dont l'evidence contient une
   **proposition relationnelle explicite entre deux sujets suivis** → candidat **immédiat** (cooc=1) → même juge.
   Déclencheur = un détecteur déterministe de marqueurs relationnels dans l'evidence (« ne pourra … qu'après »,
   « impossible tant que », « nécessite », « bloque »…) **appariant deux canonical_subject distincts**, pas un
   sujet→action. Garde-fous identiques : whitelist, evidence_text obligatoire, acteurs exclus, status='suggested',
   juge durci (contexte partagé ≠ dépendance).

**Condition amont indispensable** : l'evidence de l'occurrence visite doit **préserver la phrase relationnelle**.
Aujourd'hui les notes sont trop courtes (≈53 car., souvent absentes) et les dépendances sont formulées
sujet→action. Sans enrichissement de la note d'occurrence (ou capture de la phrase relationnelle au debrief),
la voie explicite resterait vide elle aussi. **Le maillon à enrichir est donc l'extraction/debrief de visite,
pas le juge.**

---

## Garde-fous respectés
READ-ONLY intégral (`scripts/audit-visite-relations.ts` + dry-run éphémère supprimé). Moteur PV/CR actif NON
modifié ; prompt validé NON touché ; aucun seuil changé ; aucune écriture `canonical_subject_links` ; aucun
backfill ; aucune UX ; Dépendances non réactivé ; aucune logique spéciale par site ; David ne renseigne rien.
**HARD STOP — aucun branchement visite avant GO.**
