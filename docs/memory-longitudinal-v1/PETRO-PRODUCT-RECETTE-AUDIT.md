# PETRO — Audit recette produit après mémoire longitudinale V1

Audit uniquement. Aucune modification de code. Toutes les causes sont tracées au
fichier + ligne. Aucune invention : chaque fait provient du corpus gelé R1–R7 ou
du code lu.

Cas témoins PASS (R2, R3, R4) : non traités ici — ils prouvent que
subject_detail/subject_status, timeline/subject_evolution et la mémoire
longitudinale (P0-A, PRODUCT-EVOLUTION) fonctionnent. La consigne « ne pas
toucher aux routes qui fonctionnent » est respectée : aucun correctif proposé ne
modifie leur chemin.

---

## AXE A — ROUTING

### A1 — Bug « sujets ouverts » routé en stagnation (R1) — P0

**Preuve (corpus R1)** : question « Quels sont les sujets encore ouverts sur ce
chantier ? » →
```
family: "stagnation"
comprehensionIntent: "stale_subjects"
appliedRules: ["family:stagnation"]
answer: "Aucun sujet ne franchit actuellement le seuil de stagnation. Le sujet
le plus ancien sans évolution significative est « … », à 22 jours."
```

**Chaîne causale complète**

1. `detectIntent()` classe la question en `READ` (garde READ, `copilot-intent-router.ts:711`)
   — pas de bug ici.
2. La couche de compréhension LLM renvoie `intent: 'stale_subjects'` (le LLM
   choisit dans le vocabulaire fermé `COMPREHENSION_INTENTS`,
   `copilot-comprehension.ts:43-57` ; « encore ouverts » est linguistiquement
   proche de « ce qui n'est pas clos », que le prompt n'oppose jamais à la
   stagnation).
3. `mergeComprehension()` applique la règle d'affinage
   `copilot-comprehension.ts:470-473` :
   ```ts
   const family = comprehension.intent === 'stale_subjects' && labelFamily !== null
     ? 'stagnation'
     : labelFamily
   ```
   → `classification.primary` devient `stagnation`. C'est l'origine de
   `appliedRules: ["family:stagnation"]`.
4. `resolveQuantitativeVerdict()` (`copilot-context.ts:352-404`) reçoit
   `primaryIntent: 'stagnation'` (via `classification.primary`,
   `copilot-free-prepare.ts:1852`). Aux **lignes 370-373** :
   ```ts
   const key = input.primaryIntent === 'stagnation'
     ? 'subjectsStagnant'
     : QUANTITATIVE_TOPICS.find((t) => t.match.test(input.question))?.key ?? null
   ```
   Dès que `primaryIntent === 'stagnation'`, la clé est **forcée** à
   `subjectsStagnant`. Le regex `subjectsOpen` (`QUANTITATIVE_TOPICS[3]`,
   `copilot-context.ts:332-335`), pourtant présent et correct, n'est **jamais
   testé** sur cette question.

**Règle déterministe fautive** : la branche ternaire `copilot-context.ts:370-373`.
Le canal `subjectsOpen` est bien mesuré et transmis (`copilot-free-prepare.ts:1860`
`subjectsOpen: briefing.subjectsOpen.length` ; source `visit-briefing.ts:186-229`),
mais l'aiguillage par clé le court-circuite.

**Conflit d'ordre de priorité** : le mécanisme `isSubjectsOpenQuestion`
(`copilot-context.ts:363-368`) a bien été conçu pour reconnaître la question
indépendamment de l'intent principal — il sert à activer `isCountingFamily`.
Mais il n'est utilisé QUE pour l'admission (`isCountingFamily`), pas pour le
choix de clé. `stagnation` gagne sur `subjectsOpen` au moment de résoudre la clé.
La regex `subjectsOpen` matche pourtant bien « sujets encore ouverts » :
`/\bsujets?\b[\s\S]{0,30}(?:encore )?(?:ouverts?|actifs?|en cours)\b/i`.

**Correctif minimal (une condition)** : faire primer le sujet nommé sur l'intent
inféré. Dans `resolveQuantitativeVerdict`, tester le regex `subjectsOpen` AVANT
la bascule `stagnation` :
```ts
const key =
  isSubjectsOpenQuestion ? 'subjectsOpen'
  : input.primaryIntent === 'stagnation' ? 'subjectsStagnant'
  : QUANTITATIVE_TOPICS.find((t) => t.match.test(input.question))?.key ?? null
```
(`isSubjectsOpenQuestion` est déjà calculé ligne 364.) Un mot explicitement
présent dans la question (« ouverts ») doit l'emporter sur une famille inférée
par le LLM (« stale »). C'est la même doctrine que celle déjà appliquée pour les
codes techniques vs indices LLM (`copilot-comprehension.ts:496-510`).

Aucun autre chemin n'est touché : `stale_subjects` réel (« qu'est-ce qui
n'avance pas ? », détecté par `STAGNATION_SIGNALS`, `copilot-classify.ts:87-99`)
ne matche pas le regex `subjectsOpen` et continue de résoudre `subjectsStagnant`.

---

### A2 — Bug READ→CREATE (R6) — P0

**Preuve (corpus R6)** : « Que dois-je absolument vérifier à ma prochaine visite
sur le site ? » → carte de proposition dont le titre reprend la question.

**Chaîne causale**

1. Il existe une garde déterministe dédiée EXACTEMENT à ce cas :
   `isVisitPrepRequest()` (`copilot-intent-router.ts:598-602`), qui, si elle
   matche, retourne `READ/strong` avant toute branche d'écriture
   (`copilot-intent-router.ts:675-677`, commentaire « recette PETRO, 2026-08-15 »).
2. `VISIT_PREP_REQUEST_RE` (`copilot-intent-router.ts:569-580`) contient la
   sous-règle censée capturer R6 :
   ```
   \b(?:je\s+dois|dois\s+je)\s+(?:\w+\s+){0,2}?${CHECK_VERB}
   ```
   avec `CHECK_VERB = (?:verifi|surveill|control|regard|inspect|check)\w*`
   (`copilot-intent-router.ts:567`).
3. **Défaut prouvé sur la formulation R6** : après `normalizeQuery`, la question
   devient `que dois je absolument verifier a ma prochaine visite sur le site`.
   Entre `dois je` et `verifier` s'intercale **« absolument »** (1 mot) — donc
   `(?:\w+\s+){0,2}?` (0 à 2 mots) devrait tolérer. Le point de rupture réel est
   `PLAN_WRITE_BLOCKER_RE` : `isVisitPrepRequest` retourne `false` dès qu'un verbe
   d'insertion est présent (`copilot-intent-router.ts:600`). Or R6 n'en contient
   pas. La règle `je dois … verifier` DEVRAIT donc matcher.

   Le vrai déclencheur du CREATE est en aval : la question porte « prochaine
   visite » (`NEXT_VISIT_RE`, `copilot-intent-router.ts:106`) ET, si la garde
   `isVisitPrepRequest` échoue pour une raison de formulation (voir ci-dessous),
   la **Priorité 1 ADD_VISIT_ITEM** (`copilot-intent-router.ts:727-730`) prend la
   main :
   ```ts
   if (hasNextVisit && !hasAction && !hasQuestionMark && !hasNegatedWrite) { … ADD_VISIT_ITEM }
   ```
   `hasQuestionMark` exclut normalement une question finissant par « ? ». R6 se
   termine par « ? » → cette branche est bloquée. Donc ADD_VISIT_ITEM n'est pas
   la cause si le « ? » est présent.

4. **Cause la plus probable, à confirmer sur la trace réelle** : la carte de
   proposition R6 provient du chemin d'écriture générique
   (`resolveWriteBranch` → `buildCopilotProposal`, `copilot-free-prepare.ts:1210`),
   ce qui n'est atteignable que si `intentResult.intent !== 'READ'`. Deux
   hypothèses restent ouvertes, toutes deux dans le périmètre de la garde :
   - **H1 (formulation)** : la sous-règle `je dois … CHECK_VERB` ne matche pas
     parce que la distance réelle mot-à-mot dépasse la fenêtre `{0,2}` sur la
     transcription vocale réelle (mots parasites STT), et le « ? » est absent de
     la transcription STT (l'oral n'a pas de ponctuation). Sans « ? »,
     `hasQuestionMark = false`, et ADD_VISIT_ITEM (Priorité 1) crée un point de
     visite intitulé avec la phrase — exactement le symptôme décrit.
   - **H2 (garde non atteinte)** : `isVisitPrepRequest` est bien la première
     règle (`copilot-intent-router.ts:675`), donc si elle matchait, aucun CREATE
     ne serait possible. Le fait qu'un CREATE se produise **prouve** qu'elle ne
     matche pas sur la forme réellement reçue.

**Verdict A2** : le bug est une **couverture incomplète de `VISIT_PREP_REQUEST_RE`
sur la formulation orale de R6**, aggravée par l'absence de « ? » en transcription
vocale qui rouvre la Priorité 1 ADD_VISIT_ITEM. La règle existe déjà et vise ce
cas (commentaire PETRO 2026-08-15) ; elle ne couvre simplement pas cette variante.

**Élément load-bearing à vérifier sur trace** : le log `[copilot-trace] routing`
(`copilot-free-prepare.ts:1642`) porte `det`, `merged`, `applied` et `q` pour ce
tour. Il tranchera H1 vs H2 en une ligne (présence/absence de
`visit_prep_request` dans les signaux, et valeur de `merged`).

**Correctif minimal (élargir la règle existante, sans toucher aux branches
d'écriture)** :
- Élargir la fenêtre entre `je dois`/`dois je` et le verbe de contrôle :
  `(?:\w+\s+){0,3}?` au lieu de `{0,2}?` couvre « absolument » + un mot parasite
  STT (`copilot-intent-router.ts:573`).
- OU ajouter « à ma prochaine visite » comme forme reconnue de demande de plan :
  une question (`hasQuestionMark` OU intonation interrogative « que/qu'est-ce que »)
  portant `NEXT_VISIT_RE` sans verbe d'insertion (`PLAN_WRITE_BLOCKER_RE`) est une
  demande de LECTURE du plan, jamais une insertion.

**Contrainte respectée** : le correctif reste borné à `isVisitPrepRequest` /
`VISIT_PREP_REQUEST_RE`, qui court-circuitent AVANT toute branche d'écriture. R2,
R3, R4 n'empruntent jamais ce chemin (ni « prochaine visite » ni verbe de
contrôle) → aucun risque de régression sur les PASS.

---

## AXE B — COUNTS → ITEMS

### B1 — Détection du problème (R5) — P1

**Preuve (corpus R5)** : « Depuis votre dernière visite le 20 août 2026, 2
nouvelles actions ont été créées et 8 actions ont été clôturées. » — aucun nom
d'action. La Prévisite affiche « 8 actions terminées » **deux fois**.

**Où les listes existent déjà mais sont perdues**

- **Copilote (R5 conversationnel)** : la réponse « 2 créées / 8 clôturées »
  vient de `extra.visitDelta` (`copilot-free-prepare.ts:1956-1967`), alimenté par
  `briefing.delta` (`visit-briefing.ts:163-170`). Ce delta est calculé par des
  requêtes `count: 'exact', head: true` (`visit-briefing.ts:134-157`) : **seuls
  les compteurs sont chargés, jamais les titres**. Les actions clôturées existent
  pourtant en base (`site_actions` avec `done_at > lastVisitAt`) — la requête les
  compte au lieu de les lister.

- **Prévisite (R5 UI)** : le doublon « 8 actions terminées » vient de deux
  champs distincts construits depuis la MÊME source `sinceLastVenue.actionsDone`
  (un simple nombre) :
  - `changedSinceVenue` — `site-brief-actions.ts:811` → rendu section « Ce qui a
    changé depuis votre venue » (`SiteBriefButton.tsx:851-859`) ;
  - `completedSinceVenue` — `site-brief-actions.ts:819` → rendu section « Ce qui
    semble terminé » (`SiteBriefButton.tsx:869-874`).

  `SinceLastVisitSummary` (`lib/db/visits.ts:1269-1288`) ne porte que des
  compteurs (`actionsDone: number`, `newReserves`, `liftedReserves`…) — jamais de
  liste. C'est la limite structurelle qui rend le compteur seul inévitable ici.

  **Mais** `getSiteBriefAction` charge déjà `doneActionRows`
  (`site-brief-actions.ts:356` `listSiteActionsBySite(siteId, {status:'done'})`)
  avec titres et `done_at`, et les utilise pour `recentDoneActions` (top 3, section
  « Récemment fait », `site-brief-actions.ts:544-548`). Les titres des actions
  clôturées sont donc **déjà en mémoire du serveur** — ils ne sont simplement pas
  injectés dans `changedSinceVenue`/`completedSinceVenue`.

### B2 — Doctrine de placement unique

Un même fait ne doit apparaître qu'une fois, et jamais sous forme de compteur nu
quand une liste déterministe existe.

1. **Un compteur est un résumé, pas la seule information** dès qu'une liste
   déterministe existe. Format cible :
   « 8 actions clôturées, dont : Action A, Action B, Action C (+5 autres) ».
2. **Le même fait n'apparaît qu'une fois.** « Ce qui a changé depuis votre venue »
   raconte l'évolution globale (créées + clôturées + réserves + photos). « Ce qui
   semble terminé » ne doit PAS re-lister les actions clôturées déjà comptées
   au-dessus : soit on retire la ligne « actions terminées » de
   `completedSinceVenue`, soit on retire le résumé « terminées » de
   `changedSinceVenue` et on garde le détail uniquement dans « Ce qui semble
   terminé » (choix produit : le second est plus lisible car le titre « terminé »
   correspond à la section).

### B3 — Wiring (où faire l'enrichissement count→items)

- **Prévisite UI (R5 UI)** — la correction se fait dans
  `site-brief-actions.ts` :
  - `completedSinceVenue` (`site-brief-actions.ts:818-821`) : remplacer la ligne
    compteur `sinceLastVenue.actionsDone` par les titres de `doneActionRows`
    filtrés `done_at > sinceLastVenue.at`, tronqués (« +N autres »). La donnée est
    déjà là (`doneActionRows`).
  - `changedSinceVenue` (`site-brief-actions.ts:809-816`) : retirer la ligne
    « actions terminées » (compteur) puisque le détail passe désormais par « Ce
    qui semble terminé » — supprime le doublon à la source. Garder les autres
    lignes chronologie (réserves, photos, réunions).
  - Le composant `FactLines` (`SiteBriefButton.tsx:416-433`) accepte déjà des
    listes de `SiteBriefFactLine` : aucune modification UI nécessaire, seul le
    contenu injecté change.

- **Copilote (R5 conversationnel)** — la correction se fait dans le contrat
  transmis au LLM. `briefing.delta` (`visit-briefing.ts:163-170`) ne porte que des
  compteurs ; il faudrait joindre les titres des actions créées/clôturées à
  `extra.visitDelta` (`copilot-free-prepare.ts:1956-1967`) pour que le LLM puisse
  les nommer. `buildVisitBriefing` doit alors sélectionner les titres (limite ~3
  + « +N autres ») en plus des `count`. C'est un enrichissement de contrat, pas un
  nouveau moteur — mêmes requêtes, `select('title, done_at')` au lieu de
  `count: head`.

**Gravité** : P1 (défaut de lisibilité, pas de fausse information). La correction
Prévisite (retrait du doublon + titres depuis `doneActionRows`) est locale et sans
requête nouvelle. La correction Copilote demande d'élargir la requête delta.

---

## AXE C — PÉREMPTION / OBSOLESCENCE

### C1 — Ce que les données actuelles permettent de conclure sur « matériel » (R7)

**Preuve (corpus R7)** : action « S'assurer de la mise à disposition du matériel
nécessaire pour l'intervention — ouverte depuis 26 j », affichée dans « Ce que je
risque d'oublier », face à des preuves récentes (nettoyeur testé 18/08, nettoyage
commencé, 4e jour d'intervention).

**Source du défaut** : `atRiskOfForgetting` (`site-brief-actions.ts:823-827`) est
construit uniquement par filtrage d'ancienneté :
```ts
vigilance.filter((item) => item.overdue || item.ageDays >= 7)  // + openActionRows anciennes
```
Aucune confrontation avec les preuves plus récentes. `vigilance` lui-même
(`site-brief-actions.ts:533-541`) ne regarde que `created_at` (âge) et `due_date`
(retard) — jamais l'activité terrain postérieure. `changedSinceVenue` et les
`activities` récentes (nettoyeur, nettoyage commencé) sont chargés dans le même
brief mais ne sont jamais croisés avec cette action.

**Ce que les données structurelles permettent DÉJÀ de conclure, sans
hallucination** :

- L'action « matériel » a `status = open`, `done_at = null` → **toujours ouverte**
  au sens strict de la base. C'est un fait.
- Aucun signal structurel ne la relie aux occurrences récentes (le nettoyeur
  testé, le nettoyage commencé sont des occurrences terrain / captures, pas des
  transitions d'état sur CETTE action). Il n'existe pas de `canonical_business_object`
  reliant « matériel » à « nettoyeur testé ».
- Le moteur d'état longitudinal (`subject-state.ts`) ne conclut jamais `resolved`
  depuis une occurrence compatible : `computeSubjectTransition` exige un
  `currSignal === 'resolved'` explicite (`subject-state.ts:101`), et
  `visitStatusToPvState` mappe `field_checked`/`mentioned` → `unknown`
  (`subject-state.ts:146-151`). Une activité récente « compatible » ne produit
  donc aucun `RESOLVED` automatique. **C'est la garde qui protège déjà** contre
  une fermeture abusive.

**Conclusion C1 (état correct à afficher)** : **toujours ouvert**, mais **à
revalider** — le système dispose des deux faits (action ancienne ouverte + activité
terrain récente sur le même chantier) sans pouvoir prouver la résolution. Il ne
doit ni la fermer, ni la présenter comme un simple oubli, mais **signaler la
tension** : « ouverte depuis 26 j — activité terrain récente, à reconfirmer sur
place ».

### C2 — Le concept `needs_revalidation` existe-t-il déjà ?

**Partiellement.** Deux briques existent, non combinées :

1. `coherenceInsights` (`site-brief-actions.ts:763-779`) : produit déjà des lignes
   « À reconfirmer : … annoncé lors de la … ; aucune confirmation plus récente. »
   avec `status: 'interpretation'`. Mais il ne s'applique QU'aux narratifs de
   visites/réunions anciennes (`narratives` validés non récents), pas aux **actions
   ouvertes anciennes** — donc il ne capte pas le cas « matériel ».
2. Le tri-state `unknown` (`subject-state.ts:14`) est précisément « absence de
   preuve ≠ open », un état de connaissance réel. C'est le socle épistémique
   correct, mais il vit au niveau `canonical_subject`, pas au niveau `site_action`.

**Verdict C2** : pas besoin d'un nouveau concept produit lourd. La forme minimale
est une **règle de confrontation** réutilisant les données déjà chargées dans le
brief :

- Forme minimale : dans `atRiskOfForgetting` (ou une sous-catégorie « À revalider »),
  marquer `status: 'interpretation'` + suffixe « — activité terrain récente depuis,
  à reconfirmer » toute action ancienne (`ageDays` élevé) **lorsqu'il existe une
  activité terrain postérieure à sa dernière trace** (`activities` /
  `sinceLastVenue.at` déjà en mémoire du brief). Aucune requête nouvelle.
- Ne jamais fermer : la ligne reste dans la Prévisite, seul son libellé et son
  `status` changent (de `validated` factuel à `interpretation` « à revalider »).

**Règle dure respectée** : aucune fermeture automatique. Le signal
« à revalider » est une nuance d'affichage, jamais une transition d'état. La garde
`computeSubjectTransition` / `visitStatusToPvState` reste la source de vérité et
n'est pas touchée.

**Gravité** : P1 (défaut de pertinence, pas de fausse fermeture). Le risque
inverse — fermer à tort — est explicitement exclu par la doctrine et par le code
existant.

---

## AXE D — COHÉRENCE DES AGRÉGATS / ÉTAT GLOBAL DU CHANTIER

### D0 — Périmètre et motivation

Les axes A, B, C traitent des défauts de **faits unitaires** : mauvais canal,
doublon, action non confrontée. L'axe D traite d'un problème de niveau supérieur :
**des faits unitaires corrects qui produisent un état synthétique faux ou
anachronique au moment de la consommation**.

La mémoire longitudinale (tri-state, firstSeenAt/lastSeenAt, lastMeaningfulChangeAt,
actions et deadlines liées) est désormais saine. Mais au-dessus, MemorIA produit
des **concepts synthétiques** :

- phase estimée du chantier ;
- démarrage du chantier ;
- motif opérationnel principal ;
- ce qui semble terminé ;
- état actuel ;
- changements depuis la dernière venue.

Ces agrégats ont leurs propres règles de construction. Elles n'ont pas subi le
même niveau d'audit que la mémoire longitudinale.

### D1 — Cas sentinel PETRO

Les visites terrain documentent :

- **17/08** : « premier jour de chantier », balayage et regroupement des gravats ;
- **18/08** : test du nettoyeur haute pression réussi ;
- **20/08** : nettoyage de l'entre-toit commencé, présenté comme quatrième jour
  d'intervention.

Il existe donc des **preuves factuelles d'activité réelle** sur le chantier.
En parallèle, la Prévisite affiche :

> **Phase estimée : Dépose**

et des éléments de préparation ou démarrage futur. Ce n'est pas nécessairement
contradictoire, mais la question est : **quelle donnée fait foi et avec quelle
date ?**

### D2 — Distinction requise

| Concept | Ce que les données permettent de dire | Ce qu'elles ne permettent pas de dire |
|---|---|---|
| Activité terrain constatée | OUI — interventions documentées 17, 18 et 20 août | — |
| Intervention commencée | OUI — « 4e jour d'intervention » explicite le 20/08 | — |
| Démarrage contractuel/officiel | **INCONNU** si aucune donnée ne le prouve explicitement | Ni OUI ni NON |
| Phase métier estimée | Dérivée des occurrences les plus récentes | Doit être datée de sa source |
| Démarrage futur (ancien fait) | Vrai au moment de son émission | Ne doit plus représenter l'état courant |

**Doctrine appliquée** : absence de preuve ≠ faux. Une observation ne doit pas
être transformée en un état plus fort que ce qu'elle prouve (identique à P1-3).

Ne jamais créer un booléen `chantierStarted` : trop simpliste. La représentation
cible est une **phase observée avec niveau de preuve** :

- Préparation
- Intervention commencée
- Travaux en cours
- Réception / clôture
- Indéterminée

### D3 — Le problème de l'ancien fait

Exemple de cycle typique :

> CR 10/08 : « Démarrage prévu le 17 août. »
>
> Visite 20/08 : « Le nettoyage de l'entre-toit a débuté, quatrième jour
> d'intervention. »

Le premier fait ne doit pas disparaître — il reste historiquement vrai :
*au 10 août → démarrage prévu le 17*. Mais il **ne doit plus représenter l'état
courant**.

MemorIA devrait être capable de raconter :

> Le démarrage était prévu le 17 août. Des interventions sont effectivement
> constatées depuis le 17 août, avec notamment le nettoyage et les travaux
> préparatoires.

C'est précisément ce qu'on attend d'une mémoire longitudinale : conserver l'ancien
fait sans le laisser écraser le présent. Ce n'est pas uniquement l'obsolescence
d'une action (Axe C), c'est **l'obsolescence d'un agrégat**.

### D4 — Questions d'audit à instruire

Pour chaque agrégat affiché (phase estimée, démarrage, motif opérationnel,
ce qui semble terminé, état actuel, changements depuis la dernière venue) :

| Colonne | Question |
|---|---|
| Valeur affichée | Quelle est la valeur affichée à l'utilisateur ? |
| Source | Quelle est la brique qui calcule cette valeur ? |
| Date de la source | Quelle est la date de la donnée source ? |
| Règle d'agrégation | Quelle règle combine les faits unitaires ? |
| Faits contradictoires plus récents | Y a-t-il des occurrences terrain plus récentes qui contredisent ou complètent ? |
| Verdict | La valeur affichée est-elle cohérente avec les preuves disponibles ? |

**Point critique** : vérifier si un ancien fait (« démarrage prévu le X ») peut
continuer à alimenter l'état courant après l'apparition de preuves terrain
postérieures.

### D5 — Diagnostic préliminaire et localisation

Les agrégats de haut niveau proviennent principalement de :

- `buildSiteIntelligenceContext` / `getSiteBriefAction` (`site-brief-actions.ts`)
  — sections `objective`, `changedSinceVenue`, `activities`, `coherenceInsights` ;
- `copilot-free-prepare.ts` — blocs `extra.sitePhase`, `extra.operationalContext`,
  `extra.visitDelta` ;
- `renderContextForLLM` (`build-site-intelligence-context.ts`) — section
  `[RÉSUMÉ OPÉRATIONNEL]`, `[PHASE]`, `[ACTIVITÉ RÉCENTE]`.

La règle de priorisation temporelle entre ces sources n'est pas auditée : un fait
plus ancien peut alimenter un agrégat même si une occurrence plus récente le
contredit, simplement parce que la règle de combinaison ignore la date de la
source.

### D6 — Verdict D et priorité

**Gravité** : P0/P1 selon les agrégats.

- Si la **phase estimée** ou le **motif opérationnel** affiché en Prévisite repose
  sur un fait antérieur aux dernières preuves terrain sans que cela soit signalé →
  **P0** (l'utilisateur reçoit une image de son chantier fausse au moment décisif
  de la préparation de visite).
- Si le défaut est uniquement une formulation trop forte sans contradiction
  explicite → **P1** (lisibilité, inférence excessive).

**Ordre dans la roadmap** : au même niveau que l'Axe C (R7). Les deux traitent
de l'obsolescence — C au niveau des actions individuelles, D au niveau des
synthèses globales. D ne crée pas de nouveau moteur ; il audite les règles de
combinaison existantes et propose des gardes temporelles là où elles manquent.

**Principe directeur** : un fait historique reste vrai historiquement mais ne
doit pas nécessairement rester vrai comme état courant. Ne jamais proposer une
inférence plus forte que les preuves disponibles.

---

## PRÉVISITE — Structure

Hiérarchie réelle rendue par `SiteBriefButton.tsx` (ordre de `BriefBody`,
`SiteBriefButton.tsx:813-1056`) :

| # | Section rendue | Source | Défaut |
|---|---|---|---|
| — | Recommandations MemorIA (IA, `order-last`) | `generateDiscussionPointsAction` | hors périmètre (LLM encadré) |
| 1 | Pourquoi je vais sur ce chantier | `objective` (`:816-830`) | OK |
| 2 | Ce que je dois retenir aujourd'hui | `confirmedFacts` + `rememberToday` (`:832-848`) | OK ; `rememberToday` peut recouper `atRiskOfForgetting` (mêmes actions ouvertes) |
| 3 | Ce qui a changé depuis votre venue | `changedSinceVenue` (`:850-860`) | **R5 : compteur « 8 actions terminées » nu + doublon avec §4** |
| — | Ce qui n'est plus cohérent | `coherenceInsights` (`:862-867`) | brique « à revalider » existante, non appliquée aux actions (C2) |
| 4 | Ce qui semble terminé | `completedSinceVenue` (`:869-874`) | **R5 : re-liste « 8 actions terminées » (doublon exact de §3)** |
| 5 | Ce que je risque d'oublier | `atRiskOfForgetting` (`:876-881`) | **R7 : actions anciennes non confrontées aux preuves récentes** |
| — | Ce que je ne sais pas encore | `unknowns` (`:883-888`) | OK |
| 6 | Activité récente | `activities` (`:890-929`) | OK — porte justement les preuves récentes que §5 ignore |
| — | Preuves et sources | `proofs` (`:931-948`) | OK |
| 7 | (repliée) Voir toutes les données | `<details>` (`:951-1055`) | correctement replié |

**Diagnostic Prévisite**

- **Doublon (R5)** : §3 et §4 affichent tous deux « 8 actions terminées »
  (compteur identique dérivé de `sinceLastVenue.actionsDone`,
  `site-brief-actions.ts:811` et `:819`). Résolution = doctrine de placement
  unique (B2) : le détail nommé va en §4 « Ce qui semble terminé », le compteur
  disparaît de §3.
- **Counts sans items** : §3 et §4 sont des `FactLine` texte, alimentées par des
  compteurs alors que `doneActionRows` (titres) est déjà chargé (B3).
- **Info ancienne non confrontée (R7)** : §5 « Ce que je risque d'oublier »
  ignore §6 « Activité récente », pourtant dans le même brief. Croiser les deux
  suffit (C2).
- **Éléments importants noyés** : §5 mélange actions vraiment oubliées et actions
  anciennes déjà couvertes par une activité récente → introduire la nuance
  « à revalider » désature §5.
- **Ce qui devrait être replié** : déjà correct — le bloc exhaustif est dans
  `<details>` (`SiteBriefButton.tsx:951`).

**Objectif 30 s** : après correction (doublon supprimé, compteurs → items,
« à revalider » distinct), les cinq questions (vérifier / changé / ouvert /
terminé-à-confirmer / pourquoi) sont chacune portées par une section unique et
non redondante.

---

## VERDICT

| Défaut | Couche | Cause précise | Gravité | Correctif minimal |
|---|---|---|---|---|
| R1 — « sujets ouverts » → stagnation | routing | `resolveQuantitativeVerdict` force `key='subjectsStagnant'` dès `primaryIntent==='stagnation'` (`copilot-context.ts:370-373`), après que `mergeComprehension` a appliqué `family:stagnation` sur `intent='stale_subjects'` (`copilot-comprehension.ts:470-473`). Le canal `subjectsOpen` est mesuré (`copilot-free-prepare.ts:1860`) mais jamais atteint. | **P0** | Tester `isSubjectsOpenQuestion` (déjà calculé, `copilot-context.ts:364`) AVANT la bascule `stagnation` dans le choix de clé. Un mot présent prime sur une famille inférée. |
| R6 — READ → CREATE | routing | La garde `isVisitPrepRequest`/`VISIT_PREP_REQUEST_RE` (`copilot-intent-router.ts:569-602`) ne couvre pas la formulation réelle (fenêtre `{0,2}` entre `dois je` et le verbe de contrôle ; « ? » absent en STT rouvre ADD_VISIT_ITEM Priorité 1, `:727-730`). | **P0** | Élargir la fenêtre à `{0,3}?` (`:573`) et/ou traiter « (que) … prochaine visite » sans `PLAN_WRITE_BLOCKER_RE` comme demande de plan. Reste borné à la garde, avant toute branche d'écriture. **Confirmer H1/H2 sur `[copilot-trace] routing`.** |
| R5 — compteurs sans items | wiring / UI | `SinceLastVisitSummary` ne porte que des `count` (`lib/db/visits.ts:1269-1288`) ; `changedSinceVenue` et `completedSinceVenue` dérivent la même ligne « actions terminées » du même compteur (`site-brief-actions.ts:811` et `:819`) → doublon + aucun titre, alors que `doneActionRows` (titres) est déjà chargé (`:356`). | **P1** | Prévisite : injecter les titres de `doneActionRows` dans `completedSinceVenue`, retirer la ligne compteur de `changedSinceVenue` (doctrine de placement unique). Copilote : joindre 3 titres + « +N » à `extra.visitDelta`. Aucune requête nouvelle côté Prévisite. |
| R7 — action ancienne non confrontée | produit / UI | `atRiskOfForgetting` filtre par âge seul (`site-brief-actions.ts:823-827`) ; `vigilance` ne regarde que `created_at`/`due_date` (`:533-541`). Les preuves récentes (`activities`, `sinceLastVenue`) sont chargées mais jamais croisées. | **P1** | Réutiliser la brique « à revalider » (`coherenceInsights`, `status:'interpretation'`) : marquer « à revalider » toute action ancienne ayant une activité terrain postérieure. **Jamais de fermeture auto** (garde `computeSubjectTransition`/`visitStatusToPvState` conservée). |

### Ordre des corrections

**P0 (fausse réponse / mauvaise action produite) — d'abord :**

1. **R1** — correctif d'une condition dans `resolveQuantitativeVerdict`
   (`copilot-context.ts`). Le canal `subjectsOpen` est déjà livré et mesuré ;
   seul l'aiguillage manque. Risque nul sur `stale_subjects` réel.
2. **R6** — élargir `VISIT_PREP_REQUEST_RE` (`copilot-intent-router.ts`). À
   valider d'abord sur la trace `[copilot-trace] routing` du tour R6 pour trancher
   H1 (fenêtre regex) vs H2 (« ? » STT), puis appliquer le correctif ciblé.

**P1 (lisibilité / pertinence) — ensuite :**

3. **R5** — Prévisite : retrait du doublon + `completedSinceVenue` depuis
   `doneActionRows` (`site-brief-actions.ts`, aucune requête nouvelle). Copilote :
   enrichissement du contrat delta (requête élargie).
4. **R7** — règle de confrontation « à revalider » dans `atRiskOfForgetting`
   (`site-brief-actions.ts`), en réutilisant `coherenceInsights`.

Trois corrections locales (R1, R6, R5-Prévisite) + une règle bornée (R7)
suffisent. **Aucune refonte générale n'est justifiée** : le canal `subjectsOpen`,
le tri-state, la mémoire longitudinale et les routes PASS (R2/R3/R4) sont sains ;
les défauts sont des raccords manquants entre briques déjà livrées.
