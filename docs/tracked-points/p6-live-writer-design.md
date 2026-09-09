# P6 — Live Writer `tracked_point`

Status: **DESIGN FROZEN — ROUND 2 (D1/D3/D4 codés) — NO GO APPLY, NO GO MERGE MAIN**

Aucune migration appliquée sur une base réelle, aucune activation prod. Toute décision ci-dessous est un contrat à implémenter, pas un état déployé. Historique complet de la conception : conversation Claude Code datée 2026-09-05/09, arbitrages Vincent inclus. §2.10 documente les corrections Round 2 (D1/D3/D4) exigées par la revue de Vincent sur le lot initial — elles amendent §2.1/§2.2, ne les remplacent pas.

## 1. Périmètre

Le batch `_p6d1b-apply-global.mjs` et les RPCs pilotes 393/395/396 traitent le rattrapage historique et l'arbitrage humain. P6 ajoute un troisième mode : projection **automatique, par extraction, en continu** des résultats d'extraction (`historical_pdf` / `field_visit` / `meeting`) dans le système d'identité `tracked_point`, sans attendre un batch ni un geste humain, mais sans jamais court-circuiter l'arbitrage humain existant.

Le Live Writer réutilise `decideFoundingOld`/`decideFoundingV2` et `buildFoundingUnits` (`scripts/_p6d1a-preflight-global.ts`) comme seul moteur de classification. Il n'introduit pas de second moteur de décision.

## 2. Decisions frozen

### 2.1 Verdicts et write patterns

Quatre verdicts métier : `AUTO_CREATED`, `AUTO_LINKED`, `NEEDS_HUMAN`, `IGNORED_NOT_TRACKABLE`.

Huit gestes d'écriture possibles (un verdict peut correspondre à plusieurs gestes selon le contexte) :

- `CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK` — AUTO_CREATED, fondation CBO. INSERT `tracked_point` (CONFIRMED, founding_kind='cbo', founding_reference=cbo.id) + INSERT `tracked_point_member` + UPDATE `canonical_business_object.tracked_point_id`. Les trois écritures ou aucune.
- `CREATE_POINT_WITH_MEMBERSHIP` — AUTO_CREATED, fondation trackable_condition déterministe (décision P6-A, §2.2, amendée D1/D3 §2.10). INSERT `tracked_point` (PROVISIONAL, founding_kind='trackable_condition', founding_reference=subject_thread_id) + INSERT `tracked_point_member`.
- `ATTACH_MEMBER` — AUTO_LINKED, Point déjà fondé et actif, non CONFLICTED. INSERT `tracked_point_member` seul.
- `ENRICH_EXISTING_POINT` — AUTO_LINKED, cas du CBO tardif (décision P6-C, §2.3). Ajoute le membership s'il manque et/ou rattache le CBO s'il est encore NULL, sur un Point déjà fondé par une autre voie. Ne modifie jamais `founding_kind`/`founding_reference`.
- `CREATE_PENDING_TRACE` — NEEDS_HUMAN, aucune cible plausible. INSERT `tracked_point_pending_trace` seul.
- `CREATE_CANDIDATES` — NEEDS_HUMAN, une ou plusieurs cibles plausibles (thread-scoped >1, OU cross-thread D1, OU cross-thread + pending existant). INSERT `tracked_point_pending_trace` (si absent) + INSERT `tracked_point_identity_candidate` (un par cible réellement absente — voir §2.4 matérialisation partielle) + `reconcile_artifact` par objet effectivement créé.
- `IGNORE_NOT_TRACKABLE` — IGNORED_NOT_TRACKABLE, première tentative sur cette unité (décision D4, §2.10). Aucune écriture métier ; seul `reconcile_state`/`reconcile_event` journalisent la décision.
- `NOOP` — rejeu sans effet métier, réservé à la revalidation d'un `write_pattern` déjà `NOOP` ou `IGNORE_NOT_TRACKABLE` précédent (décision D4, §2.10). Uniquement après revalidation live, jamais sur la seule égalité de fingerprint (§2.5).

Chaque pattern est le nom du geste atomique retourné par le writer et journalisé dans `reconcile_event.write_pattern`. `IGNORE_NOT_TRACKABLE` et `NOOP` ne sont jamais interchangeables dans l'event : le premier caractérise la décision initiale « pas trackable », le second caractérise un rejeu constatant qu'une décision précédente (`NOOP` ou `IGNORE_NOT_TRACKABLE`) reste valide.

### 2.2 Décision P6-A — PROVISIONAL_TRACKABLE

> trackable déterministe (rail non-LLM, non incertain) + aucune concurrence live (aucune identité concurrente, aucun HARD membership incompatible, aucune pending/candidate contradictoire) ⇒ fondation automatique d'un Point PROVISIONAL.

Trackable via rail LLM/incertain, ou plusieurs identités possibles, ou résolution orpheline ⇒ toujours NEEDS_HUMAN. Le statut créé est PROVISIONAL, jamais CONFIRMED — la fondation automatique n'affirme pas une validation humaine, seulement un déterminisme suffisant pour commencer un suivi.

À faire figer explicitement dans le mandat P6 avant code — ce n'est pas un mandat historique retrouvé, c'est une décision de conception prise dans cette conversation.

### 2.3 Décision P6-B — Point merged

P6 ne suit jamais `merged_into_id` automatiquement. `target.status='merged'` ⇒ toujours NEEDS_HUMAN, jamais `ATTACH_MEMBER`/`ENRICH_EXISTING_POINT`. Alignement strict avec les gardes déjà en production : migration 393 (`accept_trace_identity_candidate`) garde 5, migration 396 (`associate_pending_resolution_to_point`) garde 10 — même contrôle, même refus, deux RPCs indépendantes. Si le merge doit un jour devenir une redirection suivie automatiquement, ce sera un lot dédié touchant 393/395/396/P6/read-models ensemble, jamais une doctrine P6 isolée.

`target.identity_status='CONFLICTED'` ⇒ toujours NEEDS_HUMAN, sans condition, quel que soit le statut par ailleurs.

### 2.4 Décision P6-C — provenance de fondation immuable, CBO tardif

> `founding_kind`/`founding_reference` sont la provenance de fondation du Point et deviennent immuables après création. L'apparition ultérieure d'un CBO enrichit l'identité du Point existant, elle ne réécrit pas son histoire.

Cas : un Point P a été fondé en `trackable_condition` sur un thread T (founding_reference=T). Un CBO C apparaît ensuite sur ce même thread. Si P est actif, non CONFLICTED, T est HARD member de P, `C.tracked_point_id IS NULL`, et aucune autre cible compatible/concurrente n'existe : `ENRICH_EXISTING_POINT` — UPDATE `C.tracked_point_id = P.id` uniquement. Zéro nouveau Point, zéro changement de `founding_kind`/`founding_reference`.

Explicitement rejeté : créer un second Point `founding_kind='cbo'` puis exiger une fusion humaine — ce serait fabriquer une dette que le moteur vient de résoudre lui-même. Explicitement rejeté également : muter `founding_kind` de `trackable_condition` vers `cbo` — ce champ décrit une propriété historique, pas un état courant.

`identity_status` : la promotion PROVISIONAL → CONFIRMED sur rattachement CBO tardif est conceptuellement cohérente (CONFIRMED existe déjà pour la fondation directe par CBO) mais reste une transition d'état **non retenue pour P6 v1**. En v1 : le CBO est rattaché, `identity_status` reste inchangé. Toute promotion est un GO gate distinct (§4).

### 2.5 Fingerprint et revalidation live — NOOP n'est jamais automatique sur la seule égalité de fingerprint

`input_snapshot` JSONB (valeurs en clair pour diagnostic humain : threadId, scope, proposalSetOf, cboIds triés, families triées, outcomeV2, trackability) → hash canonique → `input_fingerprint` TEXT. Contrat de canonicalisation obligatoire avant implémentation : tri stable des arrays, distinction explicite null/absent, ordre de clés fixe.

Séquence de décision NOOP : lecture `reconcile_state` → si `input_fingerprint` identique au précédent, NE PAS conclure NOOP directement → recharger sous verrou les dépendances live pertinentes au verdict précédent → checklist de revalidation propre à ce verdict :

- Précédent AUTO_LINKED/ENRICH_EXISTING_POINT : target existe, `status='active'`, `identity_status≠'CONFLICTED'`, membership attendu toujours actif, aucun membership incompatible apparu.
- Précédent AUTO_CREATED : le Point fondé existe toujours, `status='active'`.
- Précédent NEEDS_HUMAN : pending/candidates toujours à l'état pending — si un humain a résolu entre-temps (candidate acceptée, pending dismissed/resolved), ce n'est plus un NOOP, c'est une nouvelle tentative qui doit reconnaître l'état résolu sans rien recréer.

Seulement si tout est compatible → NOOP, `replayed=true`. Sinon → revalidation complète de la transition, comme un fingerprint différent. Witness 9 (§5) matérialise le cas où l'omission de cette règle produirait un contournement silencieux de la décision P6-B.

### 2.6 State / Event / Artifact

`tracked_point_reconcile_state` — une ligne courante par `(site_id, unit_key)`, UPSERT. Colonnes : site_id, unit_key, input_fingerprint, verdict, write_pattern, target_point_id nullable, updated_at. Sert au rejeu rapide.

`tracked_point_reconcile_event` — append-only, une ligne par tentative. Colonnes : id, site_id, unit_key, input_fingerprint, input_snapshot, verdict, write_pattern, target_point_id nullable, occurred_at, provenance (extraction_run_id ou source_document_id). Garde l'historique complet des transitions (y compris needs_human → auto_linked) qu'un simple UPSERT détruirait.

`tracked_point_reconcile_artifact` — enfant de `reconcile_event`. Colonnes : id, reconcile_event_id FK, artifact_kind ('tracked_point'/'tracked_point_member'/'tracked_point_pending_trace'/'tracked_point_identity_candidate'/'canonical_business_object'), artifact_id. Référence uniquement ce que CETTE tentative a effectivement créé ou modifié — si `CREATE_CANDIDATES` retrouve candidate A et C déjà existantes et ne crée que B, l'artifact du nouvel event ne mentionne que B (witness 16, §5).

`already_reconciled` n'est pas une colonne durable — c'est une propriété d'exécution. Elle apparaît dans le résultat retourné par l'appel (`{ verdict, write_pattern, replayed: boolean }`) et implicitement via `write_pattern='NOOP'` dans l'event.

### 2.7 Unicité réelle sur `tracked_point`

`UNIQUE` partiel `tracked_point_founding_identity_uidx` sur `(site_id, founding_kind, founding_reference) WHERE founding_reference IS NOT NULL`. Sémantique vérifiée dans le code déjà en production : `founding_kind='cbo'` → `founding_reference=canonical_business_object.id` (`scripts/_p6c-apply-rus.mjs`) ; `founding_kind='trackable_condition'` → `founding_reference=subject_thread_id` (migrations 392/393/395) ; `founding_kind='manual'` → `founding_reference=pending_trace_id` (migration 395 lignes 114/209). L'invariant vit sur le modèle, pas sur le ledger — un writer tiers qui ignorerait le ledger ne peut plus créer de doublon.

Réserve non levée : vérifier `count(*) WHERE founding_reference IS NULL` sur `tracked_point` avant migration réelle ; l'index reste partiel tant que ce comptage n'est pas fait.

### 2.8 Protocole de verrouillage — 8 niveaux, verrou de domaine d'identité en tête

Le verrou advisory au grain `(site_id, unit_key)` ne protège pas deux unités **distinctes** capables de fonder la même identité métier. Exemple concret : l'unité `cbo:C` et l'unité `thread:T` (trackable_condition) portent sur le même thread T mais ont des `unit_key` différents — les deux peuvent démarrer, voir 0 Point existant, et fonder chacune un Point valide au regard de l'index unique du §2.7 (`(site,cbo,C) ≠ (site,trackable_condition,T)`), alors qu'il s'agit sémantiquement de la même identité (witness 12, §5).

Verrou de domaine d'identité ajouté : `pg_advisory_xact_lock(hashtext('tracked_point_identity:' || site_id || ':thread:' || thread_id)::bigint)`, pris **avant** le verrou d'unité, pour toute unité rattachée à un thread (fondation CBO ou trackable_condition). Le second writer entrant voit alors le Point déjà créé par le premier et bascule sur `ENRICH_EXISTING_POINT`/`ATTACH_MEMBER` au lieu de fonder un second Point.

Ordre total, à respecter par tous les writers P6 et par toute évolution future de 393/395/396 :

1. advisory identity-domain lock(s), ordre lexical si plusieurs domaines concernés
2. advisory unit lock
3. CBO
4. pending trace
5. tracked_point(s), ordre UUID croissant si plusieurs cibles possibles
6. tracked_point_member
7. tracked_point_identity_candidate(s), ordre UUID croissant
8. reconcile_state

Hash advisory : réutilisation de la primitive déjà gelée `hashtext(...)::bigint` (`scripts/_p6d1b-apply-global.mjs`), pour homogénéité avec le batch existant plutôt qu'un second protocole de hash. Une collision ne fait que sérialiser inutilement deux unités sans rapport, jamais corrompre une donnée.

### 2.9 Convergence, pas ordre imposé

Le témoin 12 ne teste pas qu'un ordre particulier gagne. Propriété recherchée : convergence de l'état final quel que soit l'ordre réel d'exécution des writers concurrents — un seul Point, une seule provenance de fondation (celle du writer qui obtient le verrou de domaine en premier), le second writer enrichit sans jamais écraser `founding_kind`/`founding_reference`.

### 2.10 Round 2 (Vincent) — D1 concurrence cross-thread, D3 règle à trois paliers, D4 IGNORE_NOT_TRACKABLE

Amendements exigés par la revue de Vincent sur le lot P6 initial (branche `feat/p6-live-writer`, checkpoint gelé). Portent exclusivement sur la sous-branche `trackable_condition` de la décision P6-A (§2.2) — jamais étendus à la fondation CBO (identité déjà arbitrée en amont, §2.4) ni à la branche pending/résolution (ne fonde jamais de Point).

**D1 — une identité concurrente connue cross-thread ne peut jamais être ignorée puis laisser P6 créer un nouveau Point.** Avant toute auto-création PROVISIONAL, l'appelant TypeScript calcule `crossThreadConcurrentPointIds` (`lib/knowledge/tracked-point-write-plan.ts`) : réutilise tel quel le moteur déterministe de Phase 4 (`evaluateMembershipCandidate`, `lib/knowledge/tracked-point-membership-candidates.ts`), sans `llmJudge` — ce n'est pas un second moteur de décision, aucun câblage LLM réel introduit. Le résultat n'est qu'une proposition hors-lock ; le RPC (migration 401) revérifie chaque id sous verrou (`tracked_point.status='active' AND identity_status<>'CONFLICTED'`) avant d'en tenir compte.

Priorité des signaux : les siblings **thread-scoped** (signal fort, `tracked_point_member` actif sur ce même thread) sont toujours vérifiés en premier et priment sur les candidats cross-thread (signal faible, fuzzy). Le fallback cross-thread D1 n'intervient que si zéro sibling thread-scoped valide ne subsiste.

**D3 — règle à trois paliers, verbatim Vincent : « 0 cible → éventuellement AUTO_CREATE ; 1 cible compatible unique → AUTO_LINK/ENRICH ; plus de 1 ou contradiction → NEEDS_HUMAN. »** Appliquée à deux niveaux distincts, jamais confondus :
- Palier thread-scoped (signal fort) : 0 sibling → poursuit vers D1 ; exactement 1 sibling (revérifié sous verrou) → `ATTACH_MEMBER` ; plus d'1 → `NEEDS_HUMAN`/`CREATE_CANDIDATES`.
- Palier cross-thread D1 (signal faible/fuzzy) : dès qu'au moins un candidat cross-thread valide existe, **toujours** `NEEDS_HUMAN`/`CREATE_CANDIDATES` — même si le compte est exactement 1. Un signal fuzzy unique n'a jamais le droit d'auto-lier ; seule l'égalité stricte au niveau thread-scoped en a le droit.

**D4 — `IGNORE_NOT_TRACKABLE` distinct de `NOOP`.** Première tentative sur une unité non trackable ⇒ `write_pattern='IGNORE_NOT_TRACKABLE'`. Rejeu compatible (fingerprint identique, état live toujours non trackable) ⇒ `write_pattern='NOOP'`, `replayed=true`. Le check de compatibilité du court-circuit (§2.5) traite `NOOP` et `IGNORE_NOT_TRACKABLE` comme équivalents pour décider si un rejeu est possible, mais le `write_pattern` journalisé sur la première tentative reste `IGNORE_NOT_TRACKABLE`, jamais `NOOP`.

Corrections structurelles associées (non fonctionnelles mais bloquantes, revue Vincent) : ordre de verrouillage corrigé (§2.8 — `reconcile_state` lu sans `FOR UPDATE` à l'étape de lecture initiale, le verrou advisory de niveau 2 suffisant déjà à sérialiser les appels sur le même `unit_key`) ; `CREATE_CANDIDATES` réécrit en CTE (`WITH to_insert AS (...), inserted AS (INSERT ... RETURNING id) SELECT array_agg(id) ...`), remplaçant le construct invalide `RETURNING id INTO <UUID[]>` ; suppression totale de l'heuristique de vérité par horodatage (`created_at >= now() - interval '1 second'`), remplacée par des booléens explicites (`v_pending_created`) et les lignes exactement insérées par la CTE ; durcissement SECURITY DEFINER (`SET search_path = ''`, `REVOKE ALL ... FROM PUBLIC/anon/authenticated`, `GRANT EXECUTE ... TO service_role`) — ce RPC est autonome (aucun geste humain de porte), donc une frontière de privilège, pas un polish sécurité.

## 3. Machine à états finale

```
FoundingUnit
    │
    ▼
canonical input_snapshot
    │
    ├── hash → input_fingerprint
    │
    ▼
classify pur (decideFoundingV2)
    │
    ▼
proposed verdict
    │
    ▼
BEGIN
    │
    ▼
advisory identity-domain lock(s)
    │
    ▼
advisory unit lock
    │
    ▼
lock/reload CBO + pending + points + membership + candidates + reconcile_state
    │
    ▼
revalidate against LIVE state (jamais NOOP sur seule égalité de fingerprint, §2.5)
    │
    ├── same input + prev write_pattern ∈ {NOOP, IGNORE_NOT_TRACKABLE} + state still valid → NOOP
    ├── not trackable, 1re tentative → IGNORE_NOT_TRACKABLE
    ├── deterministic founder, thread-scoped siblings=0, cross-thread D1 candidates=0 → CREATE_POINT_WITH_MEMBERSHIP[_AND_CBO_LINK]
    ├── deterministic founder, thread-scoped siblings=0, cross-thread D1 candidates≥1 (D3) → NEEDS_HUMAN / CREATE_CANDIDATES
    ├── thread-scoped siblings=1 (revérifié sous verrou) → ATTACH_MEMBER
    ├── thread-scoped siblings>1, ou CBO tardif unique → ENRICH_EXISTING_POINT / CREATE_CANDIDATES selon le cas
    └── ambiguïté / CONFLICTED / merged / résolution orpheline → CREATE_PENDING_TRACE / CREATE_CANDIDATES
    │
    ▼
reconcile_state UPSERT + reconcile_event INSERT + reconcile_artifact × N
    │
    ▼
COMMIT
```

## 4. Invariants DB (5) et gate de vérification préalable

1. Une identité de fondation ne peut produire qu'un Point → `tracked_point_founding_identity_uidx`, §2.7.
2. Un membership HARD actif incompatible ne peut pas être créé deux fois → étend `tracked_point_member_active_thread_uidx` (mig 388, aujourd'hui limité à `scope='thread'`) par un index équivalent pour `scope='proposal_set'` sur `(subject_thread_id, proposal_ids)` — trou identifié, non comblé sans GO.
3. Une pending trace active équivalente ne peut exister qu'une fois → déjà couvert, `tracked_point_pending_trace_active_uidx` (mig 390).
4. Une candidate pending équivalente ne peut exister qu'une fois → à créer, `UNIQUE` partiel `(candidate_point_id, subject_thread_id, scope) WHERE status='pending'` sur `tracked_point_identity_candidate`.
5. Une unité possède au maximum un état courant, N événements → PK naturelle `(site_id, unit_key)` sur `reconcile_state`, aucune contrainte au-delà de la PK sur `reconcile_event`.

Le verrou de domaine d'identité (§2.8) est un protocole d'exécution (advisory lock), pas une contrainte de schéma — il ne remplace aucun des 5 invariants ci-dessus, il empêche la course qui les précède.

## 5. Matrice de tests — 18 témoins minimum (16 initiaux + 2 Round 2 D1/D4)

Conventions reprises telles quelles de `tests/lib/db/tracked-point-pending-resolution.test.ts` : intégration réelle Supabase (`createAdminClient`), données taguées `${TAG}`, fixtures `beforeAll`/`afterAll` (org → client → site(s) → document → run), un helper par entité, nettoyage enfants-avant-parents.

1. AUTO_CREATED / `CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK` — fondation CBO neuve, aucune concurrence.
2. AUTO_CREATED / `CREATE_POINT_WITH_MEMBERSHIP` — fondation trackable_condition déterministe neuve (décision P6-A).
3. AUTO_LINKED / `ATTACH_MEMBER` — Point actif non CONFLICTED déjà fondé sur ce thread.
4. NEEDS_HUMAN / `CREATE_PENDING_TRACE` — aucune cible plausible.
5. NEEDS_HUMAN / `CREATE_CANDIDATES` — plusieurs cibles plausibles, N candidates + 1 pending + N+1 artifacts.
6. NEEDS_HUMAN forcé par target `merged` — jamais `ATTACH_MEMBER`/`ENRICH_EXISTING_POINT` (décision P6-B).
7. NEEDS_HUMAN forcé par target `CONFLICTED`.
8. NOOP par rejeu identique strict — même fingerprint, aucun changement live : `replayed=true`, 0 écriture métier.
9. Rejeu à fingerprint identique MAIS état live incompatible — AUTO_LINKED vers un Point à T0, Point passe à `merged` à T1 (indépendamment, ex. `merge_tracked_points`), rejeu à T2 même fingerprint. Assertion clé : PAS NOOP, retombe sur NEEDS_HUMAN (§2.5).
10. CBO tardif sur Point trackable_condition déjà fondé — `ENRICH_EXISTING_POINT`, `C.tracked_point_id` mis à jour, `founding_kind`/`founding_reference`/`identity_status` inchangés (décision P6-C).
11. Concurrence same-unit — deux appels simultanés sur le même `(site_id, unit_key)`, même fingerprint : un seul écrit, l'autre `replayed=true`, jamais de unique_violation exposée.
12. Concurrence cross-unit / même domaine d'identité — Writer A (`unit_key=cbo:C`, thread T) et Writer B (`unit_key=thread:T`, trackable_condition) en parallèle. Assertions : aucun deadlock ; exactement un `tracked_point` ; une seule provenance de fondation (celle du writer arrivé premier au verrou de domaine, indifféremment laquelle) ; le second n'écrase jamais `founding_kind`/`founding_reference` ; `CBO.tracked_point_id` pointe sur ce même Point ; membership HARD unique ; deux `reconcile_event` cohérents avec ce que chacun a réellement fait ; aucune violation de contrainte non rattrapée.
13. Course Live Writer / RPC humaine — candidate NEEDS_HUMAN créée par le writer, acceptée par un humain via `accept_trace_identity_candidate` (mig 393) pendant qu'une nouvelle extraction relance une réconciliation sur la même unité. Assertion : le rejeu reconnaît le membership HARD posé par la RPC humaine, ne recrée rien en doublon.
14. Rollback atomique après fondation partielle simulée — échec forcé après INSERT `tracked_point` mais avant membership/CBO, via `test_only.fn_reconcile_tracked_point_unit_with_failpoint` (`supabase/testing/p6_test_failpoint_harness.sql`, harness exclusif au test, jamais une migration, jamais un paramètre RPC prod activable depuis PostgREST). Après rollback : 0 Point, 0 member, 0 modification CBO, 0 state/event/artifact.
15. Dix appels concurrents sur la même unité (pas seulement deux) — un seul effet métier, neuf rejeux/convergences propres.
16. Candidates partiellement matérialisées — A et C existent, B manque, nouvelle tentative `CREATE_CANDIDATES` : seule B créée, `reconcile_artifact` du nouvel event ne mentionne que B.
17. D1/D3 — concurrence cross-thread unique. Point P existe déjà sur thread T1 ; nouvelle unité `trackable_condition` sur thread T2, `crossThreadConcurrentPointIds` retourne `[P.id]` (containment fort ou label exact, aucun sibling thread-scoped sur T2). Assertion clé : `NEEDS_HUMAN`/`CREATE_CANDIDATES`, **jamais** `AUTO_LINKED`/`ATTACH_MEMBER` malgré l'unicité — le signal cross-thread ne bénéficie jamais du palier « 1 cible unique → auto-link » réservé aux siblings thread-scoped.
18. D4 — `IGNORE_NOT_TRACKABLE` vs `NOOP`. Première tentative sur une unité non trackable : `write_pattern='IGNORE_NOT_TRACKABLE'`, `replayed=false`. Rejeu à fingerprint identique, état live toujours non trackable : `write_pattern='NOOP'`, `replayed=true`. Assertion clé : les deux tentatives produisent des `reconcile_event` distincts et correctement typés, jamais `IGNORE_NOT_TRACKABLE` sur le rejeu ni `NOOP` sur la première tentative.

## 6. Sources — mapping vers `source_id`

`site_reports` porte à la fois `source_document_id` (→ `documents.id`) et `extraction_run_id` (migration 297, confirmé colonnes co-remplies). Précédent de convention : `canonical_subject_occurrence.source_kind`/`source_ref_id` (migration 398) — pour `field_visit`, `source_ref_id = site_reports.id` ; pour `historical_pdf`, `source_proposal_id=NULL` et idempotence par `(canonical_subject_id, source_ref_id) WHERE source_kind='historical_pdf'` (migration 317). Recommandation reprise pour la provenance `reconcile_event` : utiliser `source_document_id` plutôt que `extraction_run_id` pour `historical_pdf`, aligné sur le précédent 398/317.

## 7. Extraction vers `lib/knowledge/`

Cibles identifiées dans `scripts/_p6d1a-preflight-global.ts` (lignes 294-493) : `type FoundingUnit`, `buildFoundingUnits(sd: FullSiteData)`, `type PlannedPoint`/`PlannedMember`/`PlannedCandidate`/`PlannedPendingTrace`, `buildWritePlan(sd, units)`. Ce sont les primitives que le Live Writer doit consommer telles quelles (classification pure), pas réimplémenter. Extraction du script vers `lib/knowledge/` = prérequis d'implémentation, pas un item de conception restant.

## 8. Implementation prerequisites / GO gates

- Confirmer `count(*) FROM tracked_point WHERE founding_reference IS NULL` avant d'écrire la migration de l'index unique (§2.7).
- Extraire `buildFoundingUnits`/`decideFoundingV2`/types associés de `scripts/_p6d1a-preflight-global.ts` vers `lib/knowledge/` (§7) — dépendance du Live Writer, pas du batch seul.
- Écrire et faire relire la migration DDL complète : colonnes/index §2.7, table `reconcile_state`/`reconcile_event`/`reconcile_artifact` §2.6, index manquant `tracked_point_member` scope='proposal_set' (§4 invariant 2), index manquant `tracked_point_identity_candidate` (§4 invariant 4).
- Décision distincte, hors P6 v1, à statuer séparément avant de l'implémenter : promotion `identity_status` PROVISIONAL → CONFIRMED sur CBO tardif (§2.4).
- Mandat P6 à faire figer explicitement sur la décision P6-A (§2.2) avant code, même si elle est déjà tranchée dans ce document.
- Écrire les 16 témoins de la matrice de tests (§5) avant d'ouvrir le Live Writer à un flux d'extraction réel.

Aucun de ces prérequis n'est levé par ce document. Le document fige la conception ; il n'autorise ni migration, ni code, ni déploiement.
