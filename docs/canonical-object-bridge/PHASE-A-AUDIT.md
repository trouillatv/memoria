# PRODUCT-CANONICAL-OBJECT-BRIDGE — Phase A (audit lecture seule)

Date de mesure : 2026-08-24. Production. **Aucune écriture.**
Scripts : `scripts/_audit-canonical-object-bridge.ts`, `scripts/_audit-bridge-drilldown.ts`,
`scripts/_audit-bridge-sentinel-deadline.ts` (tous READ-ONLY, non commités).

---

## 0. Réponse à la question centrale

> Combien des objets sans `canonical_subject_id` peut-on rattacher sans LLM, sans fuzzy
> matching et sans nouvelle décision métier, uniquement en réutilisant les identités déjà
> produites par MemorIA ?

| | total | FK posée aujourd'hui | rattachables sans décision | ambigus | sans preuve |
|---|---|---|---|---|---|
| `site_actions` | 352 | **5 (1,4 %)** | **+96 → 101 (28,7 %)** | **0** | 117 |
| `site_deadlines` | 86 | **2 (2,3 %)** | **+26 → 28 (32,6 %)** | **0** | 13 |

Le chiffre exact que tu cherchais existe et il est net :

> **63 actions sans `canonical_subject_id` portent un `subject_thread_id`, et ces 63 threads
> sont présents dans `subject_thread_identity` — 63/63, vers exactement un sujet canonique,
> 0 ambiguïté, 0 désaccord avec une FK existante.**

Les 33 autres actions et les 26 échéances passent par `document_proposal_materialization`
→ `document_extraction_proposal.subject_thread_id` → `subject_thread_identity` (même table
d'arrivée, un saut de plus). 1 action supplémentaire vient d'une promotion terrain
(`site_knowledge_proposals.canonical_subject_id`).

**Aucun cas AMBIGUOUS sur l'ensemble du parc.** Quand un pont aboutit, il aboutit seul.
Quand deux ponts existent pour le même objet (63 actions ont thread **et** matérialisation),
ils désignent le même sujet dans 100 % des cas. C'est la meilleure preuve disponible que la
projection n'introduirait aucun arbitrage.

---

## 1. Nuance indispensable avant de conclure (mig 346)

`346_site_objects_canonical_subject.sql` dit explicitement que la colonne a été créée **pour
les objets terrain/copilote sans `subject_thread_id`**, et que `subject_thread_id` (mig 288)
**reste** le lien canonique des objets issus des PV. Les deux colonnes sont documentées comme
complémentaires, pas redondantes.

Et c'est bien ce que fait le code de lecture : `canonical-subject-life.ts` lit **trois**
chemins — 2B (matérialisation), 2B-bis (`subject_thread_id`), 2B-ter (FK mig 346).
`site-attention-items.ts` et `build-site-intelligence-context.ts` joignent thread → canonique
à la lecture.

Conséquence honnête, à ne pas maquiller :

- **1,4 % n'est pas le taux de connaissance du système.** Le taux réel de « MemorIA sait à
  quel sujet cet objet appartient » est de **28,7 %** (actions) et **32,6 %** (échéances) —
  c'est déjà l'union des trois chemins de lecture.
- Projeter la FK n'ajoute donc **aucune connaissance** aux surfaces qui lisent les trois
  chemins. Elle ajoute de la connaissance **uniquement** aux surfaces qui lisent la FK seule,
  et elle rend le comptage uniforme (aujourd'hui impossible en une requête).
- Le vrai trou de connaissance n'est pas là : ce sont les **117 actions / 13 échéances sans
  aucune preuve** et les **134 / 45** dont la chaîne casse en amont (§4).

---

## 2. Tableau par write-path

| Write-path | Où | Identité disponible AU MOMENT de l'écriture | Pont existant | FK projetée ? | Couverture actuelle | Défaut | Correctif minimal |
|---|---|---|---|---|---|---|---|
| **PV / import historique** (`historical_import`, et le gros du `created_from=null`) | RPC `materialize_historical_visit` (mig 258) appelé en `review-actions.ts:483` | `subject_thread_id` posé sur la ligne — **mais `subject_thread_identity` n'existe pas encore** | thread → STI (1 saut) ; matérialisation → proposition → thread → STI | **NON** | actions 0/313 · échéances 0/74 | **Ordre d'exécution** : la canonicalisation (`reconcileHistoricalPvCanonicalSubjects`, ligne 520) tourne **après** l'INSERT. À l'instant de l'INSERT l'identité n'existe littéralement pas. Rien à corriger dans l'INSERT. | Projeter la FK **juste après la ligne 521**, dans la même requête, pour les objets du run : thread (actions) et matérialisation (échéances) → STI |
| **Visite terrain / promotion** (`cr_visite`, `visit_debrief`) | `promoteKnowledgeProposal()` — `lib/db/knowledge-proposals.ts:940` | `site_knowledge_proposals.canonical_subject_id` **déjà résolu** sur la proposition | promotion (0 saut : la valeur est en main) | **NON** | actions 5/16 · échéances 1/11 | La promotion écrit `promoted_object_id` sur la proposition et **ne recopie pas** `canonical_subject_id` sur l'objet créé | Recopier `p.canonical_subject_id` dans l'INSERT de l'objet, au même endroit |
| **Réconciliation terrain** | `ensureActionThread()` — `canonical-subject-source-reconcile.ts:997-1048` | `canonicalSubjectId` est **un paramètre de la fonction** | pose `subject_thread_id` + upsert STI | **NON** | — | La fonction construit le pont… et ne le traverse pas. Elle a l'identité canonique en main et n'écrit jamais la FK de l'objet | Ajouter la projection dans le même `update` que `subject_thread_id` |
| **Copilote** | `confirmSiteAction` `site-action-write.ts:84-91` · `confirmSiteDeadline` `site-deadline-write.ts:72` | aucune identité structurelle — seulement le **titre** | `resolveCanonicalSubjectReference(siteId, title)` = **Jaccard lexical** | **OUI — les deux seuls writers du dépôt** | actions **0/10** · échéances **0/1** | Deux défauts : (a) c'est un rattachement **lexical**, exactement ce que la doctrine interdit comme preuve suffisante ; (b) c'est un `void (async …)()` détaché — même classe de bug que P0-2, l'instance serverless gèle avant la fin | Hors périmètre de ce lot. À traiter séparément (`after()` + statut du rattachement) |
| **Manuel** (`actions_list`, `desktop_site`, `report`, seeds) | `createSiteAction` / `createSiteDeadline` | aucune | aucun | non | 0/9 | Normal : un objet saisi à la main n'a pas d'identité canonique | **Aucun.** Doit rester NULL |

> **Fait le plus court de tout l'audit** : dans l'ensemble du dépôt, `site_actions.canonical_subject_id`
> et `site_deadlines.canonical_subject_id` ne sont écrits que par **deux instructions**, toutes
> deux dans le chemin copilote, toutes deux fondées sur une ressemblance lexicale de titre,
> toutes deux dans une promesse détachée. Le chemin déterministe, lui, n'écrit jamais la FK.

### Ventilation observée (`created_from`)

`site_actions` — tot / liée / rattachable / chaîne cassée / ambigu / sans preuve

```
(null)                       177     0    84    27     0    66
historical_import            136     0    11   104     0    21
cr_visite                     13     5     1     0     0     7
copilot                       10     0     0     0     0    10
seed_scopes_demo               6     0     0     0     0     6
visit_debrief                  3     0     0     0     0     3
visit_debrief_ai               3     0     0     3     0     0
autres (4 chemins)             4     0     0     0     0     4
```

`site_deadlines`

```
historical_import             48     0    13    29     0     6
(null)                        26     0    13    13     0     0
cr_visite                      7     1     0     0     0     6
visit_debrief_ai               4     1     0     3     0     0
copilot                        1     0     0     0     0     1
```

---

## 3. Estimation avant / après

```
site_actions    :   5/352 (1,4 %)  →  101/352 (28,7 %)     gain +96
site_deadlines  :   2/86  (2,3 %)  →   28/86  (32,6 %)     gain +26
```

Décomposition du gain :

| Pont | actions | échéances |
|---|---|---|
| `subject_thread_id` porté par la ligne **et** matérialisation concordante | 63 | — |
| matérialisation seule | 32 | 26 |
| promotion terrain (`skp`) | 1 | 0 |

Ce gain est **entièrement déterministe** : aucun LLM, aucun Jaccard, aucune décision métier.

---

## 4. Pourquoi la chaîne casse ailleurs (les 134 / 45)

| Cause | actions | échéances |
|---|---|---|
| Aucune identité : ni thread, ni matérialisation, ni promotion | 125 | 13 |
| Proposition PV **sans** `subject_thread_id` | 104 | 29 |
| Thread de la proposition **absent** de `subject_thread_identity` | 19 | 13 |
| Promotion terrain dont le canonique n'a jamais été résolu | 3 | 3 |

Racine amont mesurée : **1 280 / 6 821 propositions PV (18,8 %) n'ont pas de
`subject_thread_id`.** Et sur les 45 propositions terrain promues, seules 20 portent un
canonique résolu (18 `resolved`, 11 `not_found`, 16 `null`).

Ces objets ne sont **pas** rattachables aujourd'hui sans inventer une décision. Ils relèvent
d'un lot amont (attribution du thread à l'extraction), pas de ce lot-ci. **Ils doivent rester
NULL.**

---

## 5. Fusions

| Mesure | Valeur |
|---|---|
| `canonical_subject` `status='merged'` | 307 / 961 |
| `merged` sans `merged_into` (impasse) | **0** |
| Chaînes non résolubles ou cycliques | **0** |
| Chaînes à **1 saut** | 276 |
| Chaînes à **2 sauts** | **31** |

**Résultat qui contredit l'hypothèse de travail** : la chaîne de fusion n'est *pas* plate.
31 sujets exigent **deux** déréférencements. Un pont naïf qui suivrait `merged_into` une seule
fois atterrirait sur un sujet encore `merged` — donc écrirait une FK vers un perdant.

Sur les cibles de pont effectivement rencontrées, 31 pointaient vers un sujet fusionné, toutes
résolues par le walk borné (1 ou 2 sauts, aucune cassée).

→ **Toute projection de FK doit passer par un `winner()` itératif borné.** Aucune fonction DB
ne fait ce walk aujourd'hui ; il doit être applicatif. Conformément à la consigne, **aucune
référence de fusion n'a été corrigée dans ce lot.**

---

## 6. Sentinelles PETRO

| Sentinelle | Objet | Verdict | Ce que ça prouve |
|---|---|---|---|
| **Cadenas** (positif) | action `714d040e` « Finaliser la sécurisation du site (cadenas) » | `ALREADY_LINKED` → `6801ce5c` | Le cas positif est réel |
| **Cadenas** (angle mort) | action `50c306b1` « Présenter le cadenas à code lors de l'accueil sécurité » | `BRIDGE_AVAILABLE_NOT_PROJECTED` → `6801ce5c` via promotion | **Le Cadenas n'est pas « déjà relié » : il l'est à moitié.** La proposition promue porte le canonique, l'action créée ne l'a pas reçu |
| **Cadenas** (échéance) | échéance `0039acec` « Présentation du cadenas à code » | `ALREADY_LINKED` → `6801ce5c` | Contrôle positif côté échéances |
| **Eau panneaux** | action `dbb63cef` « Nettoyer l'autre côté du mur où l'eau s'écoule derrière les panneaux en bois » | `ALREADY_LINKED` → `1d41b3f1` « Écoulement d'eau derrière les panneaux en bois » — **et le pont promotion, calculé indépendamment, désigne le même sujet** | Contrôle de validité du pont `skp` : il retrouve seul une FK posée par ailleurs |
| **Planning** | action `99c99021` « Transmettre le planning d'aménagement au client » | `NO_IDENTITY_EVIDENCE` — FK, `subject_id`, thread, matérialisation, promotion : tous NULL | **Aucun lien ne sera fabriqué.** Reste NULL |

### Échéance « Démarrage du nettoyages » — `f0a18663`

`site=PETRO` · `report=22b3f95e` · `created_from=cr_visite` · `due=2026-08-17` · créée le 2026-07-28
`canonical_subject_id=NULL` · `subject_id=NULL` · **0 matérialisation** · **0 promotion**

Pourquoi elle est NULL — cause exacte, pas hypothèse :

Le rapport `22b3f95e` a produit **4 propositions `kind=deadline`** et **3 échéances réelles**.
Une seule paire est appariée (`170e30c0` → `0039acec`, statut `fulfilled`). `f0a18663` n'est la
promotion d'aucune proposition : elle a été **créée à part**, sans passer par le journal de
promotion. Elle n'a donc jamais eu de porteur d'identité.

La tentation lexicale est là, et elle est piégée :

```
983fe735  kind=deadline  statut=dismissed  canonical=a3a70db3 (resolved)  promu=NULL
          « Démarrage du nettoyage des panneaux isothermes »
```

Cette proposition ressemble beaucoup, et elle porte un canonique résolu. Mais :

1. elle est **`dismissed`** — un humain l'a écartée. La rattacher reviendrait à ressusciter
   par ressemblance une proposition rejetée ;
2. elle n'a **jamais été promue** (`promoted_object_id = NULL`) — il n'existe aucun lien
   structurel entre elle et `f0a18663` ;
3. **la portée sémantique ne coïncide pas.** « Démarrage du nettoyage**s** » est générique.
   Le chantier porte au moins deux sujets de nettoyage actifs et distincts :
   `a3a70db3` « Nettoyage panneaux isothermes (chambres froides) » et
   `d86ed47d` « Sols de la plonge vaisselle » (plus `3abf6a16`, fusionné). Un rattachement
   lexical devrait donc trancher entre deux sujets — c'est-à-dire **produire une décision
   métier**, exactement ce qui est interdit.

> **Verdict : `NO_IDENTITY_EVIDENCE`. Reste NULL.** Et si l'on tentait quand même le chemin
> lexical, le verdict correct serait `AMBIGUOUS`, pas un rattachement. Les constats
> « nettoyage de la plonge batterie » **ne sont pas** présumés porter la même obligation.

Cette sentinelle joue exactement son rôle : elle est le cas où un humain comprend, et où le
système doit s'abstenir.

---

## 7. P0 proposé — le plus petit possible, au point de projection

Un seul helper, quatre points d'appel, aucune nouvelle table, aucune migration.

```
projectCanonicalSubjectOnObjects({ siteId, objectIds })
  résout, dans cet ordre et sans jamais deviner :
    1. site_actions.subject_thread_id      → subject_thread_identity
    2. document_proposal_materialization   → document_extraction_proposal.subject_thread_id
                                           → subject_thread_identity
    3. site_knowledge_proposals.canonical_subject_id (promotion)
  puis winner() : walk borné sur merged_into (≥ 2 sauts observés en production)
  n'écrit QUE si l'ensemble des cibles atteintes a exactement UN élément
  n'écrase JAMAIS une FK déjà posée ; un désaccord est journalisé, pas arbitré
```

Points d'appel — tous **au moment de la création**, aucun n'est un balayage :

| # | Où | Pourquoi là |
|---|---|---|
| 1 | `review-actions.ts`, juste après la ligne 521 | L'identité vient d'être créée ; c'est le premier instant où la projection est possible. Corrige tout le flux PV pour l'avenir |
| 2 | `promoteKnowledgeProposal()`, `knowledge-proposals.ts` ~940 | La valeur est déjà en main, un champ à recopier |
| 3 | `ensureActionThread()`, `canonical-subject-source-reconcile.ts:1030` | Même `update` que `subject_thread_id` |
| 4 | `runCanonicalReconciliation()` (chemin cron/replay P0-2) | Rend la projection **rattrapable** : une visite reprise par le sweep projette aussi |

Ce que le P0 ne fait pas, volontairement : aucun statut métier touché, aucune action ni
échéance fermée, aucun appel LLM, aucun Jaccard, aucune ligne `AMBIGUOUS` ou
`NO_IDENTITY_EVIDENCE` écrite.

**Estimation de l'effet du P0 seul** : il ne rattrape pas l'historique. Il garantit que les
objets créés ensuite naissent liés. Le parc existant reste à 5/352 et 2/86 tant que le §8
n'est pas exécuté.

---

## 8. Backfill — présenté séparément, sur demande explicite seulement

Périmètre **strictement** limité aux lignes classées `BRIDGE_AVAILABLE_NOT_PROJECTED` :
**96 actions** et **26 échéances**. Rien d'autre.

Conditions d'exécution proposées :

1. dry-run produisant la liste exhaustive `objet → sujet → pont emprunté → nb de sauts de fusion` ;
2. refus d'écrire si la cible atteinte est encore `status='merged'` après le walk ;
3. refus d'écrire si `canonical_subject_id` est déjà non-NULL ;
4. re-mesure de la couverture après coup, avec le même script d'audit.

Il ne masquerait pas la cause : la cause (§2) est corrigée par le P0, qui vient avant.

---

## 9. Ce qui reste NULL et doit le rester

- 117 actions + 13 échéances sans aucune preuve d'identité ;
- 134 actions + 45 échéances dont la chaîne casse en amont (proposition PV sans thread) —
  lot amont distinct ;
- l'échéance « Démarrage du nettoyages » ;
- l'action « Transmettre le planning d'aménagement au client » ;
- tout objet saisi manuellement.

## 10. Constats hors périmètre, notés et non traités

- Les deux seuls writers actuels de la FK sont lexicaux **et** dans une promesse détachée
  (`void (async …)()`), même classe de bug que P0-2 : **0 lien produit sur 10 actions et
  1 échéance copilote**. Non prouvé que la cause soit la promesse détachée plutôt qu'un
  `not_found` du resolver — à instrumenter dans un lot dédié.
- 18,8 % des propositions PV sans `subject_thread_id` : plafond amont de toute couverture future.
- `MERGE REFERENCE RESOLUTION` reste en HOLD ; aucune référence de fusion corrigée ici.
- `deriveCanonicalAttentionItems()` non touché.
- Sujets « Accès sécurisé » et « Gestion du matériel sur site non sécurisé » non touchés :
  RELATED, jamais SAME_SUBJECT.

---

**HARD STOP.** Aucun UPDATE, aucun backfill, aucune migration, aucun merge, aucun LLM,
aucun commit, aucun push n'a été exécuté.
