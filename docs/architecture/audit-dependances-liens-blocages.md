# Audit READ-ONLY — Dépendances / « Liens & blocages »

**Statut : ANALYSÉ (READ-ONLY). Aucun code produit modifié. HARD STOP — attend le GO de Vincent avant toute implémentation.**
**Date : 2026-08-29 · Périmètre : modèle relationnel entre sujets, corpus réel, workflow d'acquisition, UX, placement produit.**

---

## 0. Verdict en une page

MemorIA n'a pas **un** graphe de relations métier : il en a **trois**, empilés dans le temps, qui
ne partagent ni la même table, ni la même surface d'affichage, ni le même mode d'acquisition. Et,
sur les chantiers réels, **ce graphe est quasiment vide** : 0 relation sur BELLA NAPOLI, 0 sur
l'OCEF de production, 1 relation (semée par script de test) sur PETRO. Les **51** liens qui existent
sont **tous** concentrés sur **une seule fixture de recette périmée** (`OCEF Compostage 2c939e67`),
et **30/51 sont des `relates_to`** — exactement la « poubelle sémantique » que la doctrine mig 145
voulait interdire.

**Scénario retenu : B (modèle correct, corpus trop pauvre → réparer l'ACQUISITION et la CONVERGENCE
avant tout enrichissement), avec un garde-fou C explicite (ne PAS construire un graphe réseau /
drag & drop sur des données vides).**

La cause n'est pas que les dépendances n'existent pas dans la réalité — Guillaume les énonce du tac
au tac (« DOE bloque réception », mig 145). La cause est que **l'acquisition est cassée par
fragmentation** : trois systèmes concurrents, un onglet d'affichage branché sur la **mauvaise** table,
le seul chemin d'acquisition réellement utilisable (Copilote RELATION_CLAIM) écrit dans une table
**absente** de l'onglet Suivi, et l'affordance humaine « A bloque B » existe mais sur une fiche
**legacy morte** (0 ligne, jamais utilisée).

Concrètement, cela recoupe les intuitions produit de Vincent : mettre les dépendances **sur la fiche
de chaque sujet**, retirer l'onglet global tant qu'il n'est pas un vrai réseau, et poser
« relation proposée IA ≠ vérité métier ».

---

## 1. Phase A — Le modèle relationnel (ce qui existe en base)

Trois tables coexistent. Aucune n'a été supprimée en migrant vers la suivante.

### A.1 — `subject_relation` (mig 145, 2026-06-21) — « A BLOQUE B »
- **Cible** : table `subjects` (sujets **opérationnels** legacy), PAS `canonical_subject`.
- **Modèle** : arête dirigée unique `from BLOQUE to`, `reason` NOT NULL, `importance` (`critique|normal`).
- **Acte** : 100 % humain (`created_by`), zéro IA. Un seul type (`BLOQUE`) par doctrine anti-poubelle.
- **RLS** : aucune (server actions via admin client).
- **Lecture** : `getSubjectRelations` → composant `SubjectRelationControls` sur la fiche desktop
  `/sites/[id]/subjects/[subjectId]`.
- **Écriture** : `createSubjectRelationAction`.

### A.2 — `subject_thread_links` (mig 269) — liens causaux entre fils thématiques
- **Cible** : `from_thread_id`/`to_thread_id` (identifiants de **thread**), résolus vers
  `canonical_subject` via `subject_thread_identity` au moment de la lecture.
- **Modèle** : `link_type ∈ {requires, enables, causes, validates, replaces, relates_to}`,
  `status ∈ {suggested, confirmed, rejected}`, `source ∈ {human, extraction, cooccurrence}`,
  `confidence`, `justification`, `evidence_run_id`/`evidence_proposal_id`.
- **RLS** : lecture membre org, écriture manager+.
- **Lecture** : `listConfirmedLinksForSite` (confirmed uniquement) → **onglet Suivi › Dépendances**
  (`getSiteDependencyGraph`), + **Carte** (`getSiteKnowledgeGraph` §2a), + fiche canonique
  (`getCanonicalSubjectLife`, suggested+confirmed) + graphe mobile `SubjectContextGraph`.

### A.3 — `canonical_subject_links` (mig 316, « P0-B1 terrain-first ») — le modèle le plus récent
- **Cible** : `source_subject_id`/`target_subject_id` = `canonical_subject` **directement** (pas de thread).
- **Modèle** : whitelist stricte `{requires, enables, validates, causes, replaces}` (**`relates_to`
  rejeté au serveur**), unicité de paire normalisée `LEAST/GREATEST` (une seule relation par paire,
  tout type confondu), **preuve obligatoire** `canonical_subject_link_evidence.evidence_text` NOT NULL.
- **RLS** : lecture membre org, écriture manager+.
- **Écriture** : `confirmSiteRelation` (Copilote RELATION_CLAIM, `status='confirmed'` direct) +
  `produceRelationsFromOccurrences` (moteur occurrence-first, `status='suggested'`).
- **Lecture** : **uniquement** `getSiteKnowledgeGraph` §2b (la **Carte**). **PAS** l'onglet
  Dépendances.

### A.4 — Constat structurel
Le modèle **A.3 est le meilleur** : natif canonical, preuve obligatoire, anti-`relates_to`, aligné
sur la vérité occurrence-first du chantier P0. Mais **la surface qui s'appelle « Dépendances »
(A.2)** ne le lit pas. Le système le plus abouti est le moins visible ; le système le plus visible
est le legacy thread-based, pollué de `relates_to`.

---

## 2. Phase B — Le corpus réel (mesuré, READ-ONLY)

Source : `scripts/audit-dependances-corpus.ts` (aucune écriture).

### B.1 — Totaux tout le dépôt
| Table | Total | confirmed | suggested | rejected | Sites touchés |
|---|---|---|---|---|---|
| `subject_thread_links` (A.2) | **51** | 15 | 29 | 7 | **1** |
| `canonical_subject_links` (A.3) | **1** | 1 | 0 | 0 | **1** |
| `subject_relation` (A.1, BLOQUE) | **0** | — | — | — | 0 |

- `subject_thread_links` par **source** : `extraction` 38, `human` 11, `cooccurrence` 2.
  Confirmés : 11 humains + 4 extraction.
- `subject_thread_links` par **type** : **`relates_to` 30**, requires 10, validates 5, enables 3,
  replaces 2, causes 1. → la moitié du corpus est le lien « associé à » sans causalité.
- L'unique `canonical_subject_links` (PETRO, `causes`) a `created_by=null`, `copilot_proposal_id=null`,
  `evidence_run_id=null` → **semé par script de test** (`link-petro-acces-materiel.ts`, 13/08), pas
  un usage produit.

### B.2 — Sites témoins
| Site | canonical actifs | thread_links | canonical_links | BLOQUE |
|---|---|---|---|---|
| **BELLA NAPOLI** (cda9f47e) | 36 | **0** | 0 | 0 |
| **OCEF prod** (06c62e48) | 57 | **0** | 0 | 0 |
| **PETRO** (75bd3d23) | 19 | 0 | **1** (script) | 0 |
| OCEF Compostage (2c939e67) — *fixture recette périmée* | 130 | **51** | 0 | 0 |
| OCEF6 (655edb00) | 80 | 0 | 0 | 0 |

**La totalité du corpus relationnel vit sur une fixture de recette périmée** (`2c939e67`, la même
dette déjà identifiée en #232). Les chantiers réels ont **zéro** relation exploitable.

### B.3 — Ce qui est réellement affiché
- Arêtes **confirmées** (donc visibles) tous systèmes canoniques confondus : **16** (15 thread_links
  + 1 canonical_link), **toutes** sur des sites de recette.
- **29 suggestions** dorment (jamais affichées hors fiche sujet).
- Sur PETRO, l'unique relation réelle (`causes`) **n'apparaît PAS** dans l'onglet Dépendances (qui ne
  lit que `subject_thread_links` = 0 sur PETRO) — elle n'est visible que dans la Carte. Divergence
  d'affichage concrète.

---

## 3. Phase C — Le workflow d'acquisition (prouvé par le code)

### C.1 — Automatique (après import PV)
`review-actions.ts:1141` appelle `produceRelationsForRun` en **best-effort** après chaque import,
dans le même `try/catch` non bloquant que le pipeline knowledge. Ce moteur écrit **`subject_thread_links`**
(`status='suggested'`, `source='cooccurrence'`) — donc alimente la table **legacy A.2**, à partir des
`document_extraction_proposal` (co-occurrence + Gemini `qualifyLinkCandidate`).

### C.2 — Moteur occurrence-first : présent mais DORMANT
`produceRelationsFromOccurrences` (A.3, aligné P0 : lit `canonical_subject_occurrence`) n'a **aucun
appelant automatique** — uniquement des scripts de dry-run (`dry-run-relations-ocef.ts`,
`dry-run-relations-petro.ts`). Le moteur qui écrirait dans la **bonne** table (canonical, avec preuve)
n'est jamais déclenché en production.

### C.3 — Manuel Copilote (le seul chemin « propre » réellement branché)
RELATION_CLAIM (« Le SSI dépend de la mise sous tension ») → `confirmSiteRelation` →
`canonical_subject_links` (`status='confirmed'`, evidence = phrase verbatim). C'est le seul chemin qui
écrit A.3 en production… mais **0 relation produite** à ce jour (0 `copilot_proposal_id` en base).

### C.4 — Manuel humain « BLOQUE » : jamais utilisé
`SubjectRelationControls` (A.1) est fonctionnel mais posé sur la fiche des sujets **opérationnels**
legacy → **0 ligne** créée depuis mig 145 (juin). Affordance morte.

### C.5 — Synthèse workflow
L'acquisition automatique nourrit la **mauvaise** table (legacy, `relates_to`-lourde). Le moteur
occurrence-first correct est **éteint**. Les deux chemins manuels visent deux tables **différentes**
(A.1 morte, A.3 invisible dans l'onglet Dépendances). Rien ne converge.

---

## 4. Phase D — Audit UX des surfaces existantes

1. **Suivi › Dépendances** (`DependencyGraphView`) : arbre de chaînes causales (DAG), racines =
   nœuds jamais « to », récursif avec badges de type colorés et justification. **Correct visuellement**,
   mais alimenté par A.2 confirmed → **vide** sur tous les chantiers réels → n'affiche que l'état
   vide « Aucun lien entre sujets. Ajoutez des liens depuis la fiche… » — or **la fiche desktop qui
   permet d'ajouter (A.1) écrit dans une table que cet onglet ne lit pas**. Boucle cassée.
2. **Carte / `getSiteKnowledgeGraph`** : force-graph, seule surface qui fusionne A.2 + A.3. Donc la
   seule où la relation PETRO réelle apparaît. Mais c'est un écran d'exploration, pas la surface
   « dépendances métier ».
3. **Fiche canonique** (`historique/sujets/[id]` + mobile `SubjectContextGraph`) : lit A.2
   (confirmed+suggested), propose confirm/reject des suggestions. C'est **le bon endroit** produit —
   mais branché sur la table legacy.
4. **Fiche sujet opérationnel** (`subjects/[id]` + `SubjectRelationControls`) : la seule UI « A
   bloque B / en attente de » réellement pensée métier — mais sur les sujets **legacy** (A.1), 0 usage.

**Diagnostic UX** : l'affordance de création la plus juste (BLOQUE, avec raison obligatoire) et la
surface d'affichage la plus juste (fiche canonique) **existent séparément et ne se parlent pas**.

---

## 5. Phase E — Comparaison des représentations

| Représentation | Où | Force | Faiblesse |
|---|---|---|---|
| **Liste « bloque / en attente de »** (A.1) | fiche opérationnelle | lisible, orientée décision, raison visible | pas de vue d'ensemble, table morte |
| **Arbre de chaînes causales** (Dépendances) | Suivi | montre les cascades (A→B→C) | s'effondre si 0–2 arêtes ; illisible si dense/cyclique |
| **Force-graph** (Carte, mobile) | exploration | belle vue de voisinage local | non actionnable, pas de sémantique de blocage, coûteux |

Sur un corpus de **0–1 arête**, aucune de ces représentations n'a de contenu. **La question n'est pas
« quelle représentation » mais « comment obtenir des arêtes fiables »** (Phase C). La représentation la
plus utile au quotidien terrain reste la **liste par sujet** (« ce sujet bloque X / attend Y, pour
telle raison »), pas le réseau.

---

## 6. Phase F — Drag & drop : évaluation

Écarté pour la V-suivante. Raisons : (1) le geste juste sur mobile terrain n'est pas le drag mais
l'énoncé (Copilote/voix : « le SSI dépend de la mise sous tension ») ; (2) un canvas draggable
impose de résoudre placement/persistance de layout, hit-testing tactile, collisions — coût élevé pour
un corpus vide ; (3) la doctrine mig 145/316 privilégie la **raison** et la **preuve** de la relation,
pas sa position spatiale. Un simple sélecteur « ce sujet bloque… + raison » (déjà écrit dans
`SubjectRelationControls`) couvre le besoin sans drag & drop.

---

## 7. Phase G — Relations proposées par l'IA : doctrine

Le code respecte déjà « relation proposée IA ≠ vérité métier » : `produceRelations*` écrit
**toujours** `status='suggested'`, jamais `confirmed` ; seul un acte humain (ou une affirmation
explicite via RELATION_CLAIM) confirme. **Mais** deux dérives à corriger avant d'industrialiser :
- **`relates_to` (30/51)** : l'IntentRouter/qualifier laisse passer trop de « associé à » sans
  causalité. A.3 le rejette déjà au serveur ; A.2 (le moteur automatique) ne le rejette pas → la
  moitié des suggestions sont du bruit non actionnable.
- **29 suggestions non revues** : il n'existe pas de file de revue efficace hors fiche-par-fiche.
  Suggérer sans surface de tri = accumuler du bruit invisible.

Doctrine recommandée : suggestion IA = brouillon **causal uniquement** (jamais `relates_to`), avec
preuve, présenté **sur la fiche du sujet concerné**, confirmé/rejeté par l'humain — un seul modèle
(A.3), une seule file.

---

## 8. Phase H — Placement produit & recommandation

### H.1 — Verdict scénario : **B (+ garde-fou C)**
- **B** : le modèle A.3 est bon ; le corpus est trop pauvre **parce que l'acquisition est fragmentée
  et mal branchée**, pas parce que le besoin est absent. Priorité = converger + réparer l'acquisition.
- **C (garde-fou)** : tant que le corpus réel est ~0, **ne pas** construire de vue réseau riche /
  drag & drop. L'onglet global « Dépendances » actuel affiche du vide trompeur → à **retirer ou
  masquer** jusqu'à densité réelle (rejoint l'intuition de Vincent).

### H.2 — Direction recommandée (à valider — AUCUN code tant que pas de GO)
1. **Unifier sur `canonical_subject_links` (A.3)** comme table unique de vérité relationnelle
   (canonical natif, preuve obligatoire, anti-`relates_to`, aligné P0). Traiter A.1 et A.2 comme
   legacy en lecture le temps d'une convergence, sans double saisie.
2. **Rebrancher l'affichage** : `getSiteDependencyGraph` (onglet) et la fiche canonique doivent lire
   A.3 (comme le fait déjà la Carte §2b), pour que RELATION_CLAIM et les liens confirmés soient
   visibles **au même endroit** que ce que l'humain crée.
3. **Poser l'affordance « ce sujet bloque… + raison » sur la fiche du sujet _canonique_** (réutiliser
   la logique éprouvée de `SubjectRelationControls`, mais vers A.3), et **retirer l'onglet global**
   tant qu'il n'est pas un vrai réseau — exactement la proposition « DÉPENDANCES & RELATIONS sur
   chaque fiche » de Vincent.
4. **Brancher le moteur occurrence-first dormant** (`produceRelationsFromOccurrences`) en
   remplacement de `produceRelationsForRun`, pour que l'automatique alimente A.3 (suggéré, causal,
   avec preuve) et non plus la table legacy — **après** la convergence d'affichage, pas avant.
5. **Filtrer `relates_to` à la source** et offrir une file de revue des suggestions sur la fiche.

### H.3 — Ce qu'il ne faut PAS faire maintenant
- Pas de vue réseau interactive / drag & drop sur données vides.
- Pas de backfill de relations fabriquées pour « remplir » le graphe.
- Pas de 4ᵉ table ni de nouveau type de lien.
- Ne pas mélanger ce chantier avec Navigation ou P1 « David en 30 s ».

---

## 9. Garde-fous respectés
READ-ONLY intégral : lectures + 1 script de mesure (`scripts/audit-dependances-corpus.ts`) sans
écriture. Aucune migration, aucun changement d'UI, aucun backfill, aucune relation fabriquée. Workflow
prouvé par le code (`review-actions.ts:1141`, absence d'appelant pour `produceRelationsFromOccurrences`).
Corpus mesuré sur données réelles.

**HARD STOP. Attends le GO de Vincent avant toute implémentation.**
