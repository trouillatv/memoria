# P1-3A — Modèle d'état canonique

> Mode : audit / doctrine. Aucun code, aucune migration, aucune mutation DB, aucun Gemini.
> Données terrain lues en lecture seule via Supabase MCP (projet `srixnofmaydxouhucawn`, site OCEF Compostage `2c939e67-e986-4635-86a0-638cda870480`).

---

## Contexte et verdict d'entrée

Verdict gelé du P1-3 : **P1_3_MODEL_GAP**. Confirmé par les données OCEF (Étape 2) :

- `document_status` est **null pour la quasi-totalité des familles opérationnelles**. Mesuré sur OCEF :
  - `person` / `company` : `document_status` = null à 100 % (0 statut sur ~9 occurrences chacun).
  - `action` : null à ~100 % (ex. « Transmission FT Matériaux & Équipements » = 8 occurrences action, toutes `∅`, sauf un `planned` final porté par la famille knowledge_fact).
  - `observation` : null à 100 % (« Nettoyage et entretien des accès » = 7 occurrences, toutes `∅`).
  - `knowledge_fact` : **seule famille qui porte réellement un statut** (`done` / `in_progress`), et de façon intermittente (une même occurrence peut être `∅`).
- **Aucun état `resolved` stocké sur `canonical_subject`** : la table n'a que `status` (active / merged / split), pas d'état longitudinal métier.
- **Aucun porteur d'état de résolution par occurrence** : `canonical_subject_occurrence` (199 lignes `historical_pdf` sur OCEF) ne contient **ni `document_status` ni champ de résolution**. Ses seuls champs d'état sont `visit_status` (vocabulaire terrain : field_checked / still_open / not_applicable, null pour les PDF) et `validation_status` (observed / confirmed / rejected — axe *fiabilité de l'extraction*, orthogonal à l'état métier).
- **Les objets matérialisés n'apportent aucun signal terminal sur ce corpus** : sur OCEF, 62 `site_actions` toutes `open`, 14 `site_reserve` toutes `open` avec `lifted_at` **null à 100 %**, 16 `site_deadlines` en `to_plan`/`planned`. Aucune réserve levée, aucune action `done`, aucune échéance close.
- **Défaut D1** : `pv-history.ts` ligne 85 `if (hasGap) return 'réapparu'` court-circuite tout état antérieur : un sujet qui était `done` puis réapparaît est étiqueté `réapparu` au lieu de `réouvert`.
- **Deux moteurs incohérents** : `canonical-transitions.ts` (agrège « worst status wins », vocabulaire `resolved/reopened/aggravated`) et `pv-history.ts` (agrège « famille dominante », vocabulaire `levé/réalisé/réouvert/réapparu`) produisent des verdicts différents sur les mêmes données.

Conséquence directe : **on ne peut pas construire un modèle d'état fiable en dépendant de `document_status`**. Le modèle doit dériver l'état d'un PV d'un faisceau de signaux, avec `document_status` comme un signal *parmi d'autres*, et introduire un porteur d'état propre.

---

## 1. Sources d'état disponibles par famille

Colonnes réelles vérifiées en base (information_schema) :

| Table | Champs d'état pertinents | Vocabulaire observé sur OCEF |
|---|---|---|
| `document_extraction_proposal` | `document_status`, `review_status` | document_status ∈ {∅, done, in_progress, planned} |
| `canonical_subject` | `status` (identité, pas métier) | active / merged / split |
| `canonical_subject_occurrence` | `visit_status`, `validation_status` | visit_status terrain uniquement ; validation_status = observed/confirmed/rejected |
| `site_knowledge_proposals` | `status`, `canonical_resolution_status` | resolution = resolved/needs_resolution/not_found (résolution *d'identité*, pas métier) |
| `site_actions` | `status`, `due_date_status`, `ext_status` | OCEF : 100 % `open` |
| `site_reserve` | `status`, `lifted_at` (timestamptz) | OCEF : 100 % `open`, lifted_at null |
| `site_deadlines` | `status` | OCEF : to_plan / planned |
| `site_decisions` | `statut` | (pas d'occurrence sur le périmètre testé) |

Pour chaque famille :

### action
- Champs de statut de l'objet matérialisé : `site_actions.status` (open/planned/done/cancelled/…), `due_date_status`.
- `document_status` sur la proposition : **quasi toujours null**. Non alimenté de façon fiable pour cette famille.
- Signal structuré disponible : existence d'une `site_actions.status = done/cancelled` liée via `document_proposal_materialization`. **Sur OCEF ce signal est absent (tout open).**
- L'objet matérialisé PEUT être done indépendamment du sujet canonique (une action d'un sujet à N objets peut être close alors que le sujet reste ouvert).

### reservation
- Objet matérialisé : `site_reserve.status` + `site_reserve.lifted_at` (**horodatage de levée = signal structurel fort et daté, le meilleur signal disponible du modèle**).
- `document_status` sur proposition : null en pratique.
- Sur OCEF : aucune réserve n'existe côté proposals extraites (les « réserves » OCEF sont matérialisées mais toutes open, lifted_at null). Signal terminal **non observé** sur ce corpus.

### deadline
- Objet matérialisé : `site_deadlines.status` (to_plan/planned/done/…) + `due_date`.
- `document_status` : null.
- Signal : `status = done` = échéance honorée. **Attention** : une échéance est par nature un gabarit potentiellement récurrent (situation mensuelle, réunion périodique) — son `done` cyclique ne vaut pas résolution du *sujet*. (voir §5)

### observation
- Aucun objet matérialisé propre (l'observation n'est pas « done » ; elle est levée quand la situation change).
- `document_status` : null à 100 % sur OCEF. Le seul indice de résolution est **textuel** (label/description : « travaux réalisés », « point levé », « nettoyé »).
- Il n'existe **aucun** signal structurel de résolution pour cette famille. C'est le trou le plus grave.

### knowledge_fact
- Pas d'objet matérialisé opérationnel (famille exclue des compteurs : `OPERATIONAL_EXCLUDED_FAMILIES`).
- **Seule famille qui porte `document_status` de façon exploitable** : `done` = fait accompli, `in_progress` = en cours.
- Paradoxe structurant : la famille exclue des métriques opérationnelles est la seule à porter un état. Beaucoup de sujets opérationnels réels (ex. « Zone déshuileur », « Mise en place couche de forme ») sont représentés en base **principalement par des occurrences knowledge_fact** qui, elles, portent le statut.

### person / company
- Aucun état métier (jamais done). `document_status` = null par construction. Exclus du modèle d'état.

---

## 2. État canonique minimal choisi

**Décision : `open` / `resolved` / `unknown` suffit comme état porté ; `new_cycle` n'est PAS un état mais un *type de transition*.**

Justification :
- L'état doit répondre à : « à la fin de ce PV, que sait-on du sujet ? ». Trois réponses épuisent le besoin :
  - `open` — le sujet est actif / en cours / non résolu.
  - `resolved` — un signal terminal fiable a été observé (done / lifted / cancelled).
  - `unknown` — le sujet est mentionné mais aucun signal ne permet de trancher (cas ultra-majoritaire sur OCEF : `document_status = ∅`).
- `unknown` est **obligatoire et distinct de `open`**. La doctrine du dépôt (« absence ≠ résolution », « le moteur observe, ne déduit pas ») impose de ne pas transformer un `∅` en `open` par défaut, comme le fait aujourd'hui `aggregateByCanonical` (`row.document_status ?? 'open'`). Ce fallback silencieux `?? 'open'` est un **défaut à corriger** : il fabrique de l'`open` là où on n'a rien observé.
- `new_cycle_candidate` n'est PAS retenu comme état. La récurrence est une propriété de *l'identité longitudinale* (le sujet est-il un gabarit répété ?), pas de l'état d'un PV. Elle est traitée comme un discriminant de transition (§5, §6), pas comme un 4ᵉ état stocké.

L'état est **par PV / par occurrence**, indépendant de la famille « primaire » choisie : il est le résultat d'une *agrégation* de tous les signaux du PV pour ce sujet (§3), pas la lecture d'une seule proposition dominante. C'est le point de divergence avec les deux moteurs actuels (l'un prend le pire statut, l'autre la famille dominante — les deux perdent de l'information).

---

## 3. Matrice d'agrégation multi-familles

Un même sujet, dans un même PV, produit plusieurs propositions (familles + statuts) — vérifié sur OCEF : « Zone déshuileur » au 22/04 a `action ∅`, `action ∅`, `knowledge_fact ∅` ; au 16/07 a `knowledge_fact in_progress` ET `knowledge_fact done`. Il faut une règle d'agrégation déterministe produisant **un seul état de PV**.

| Signal source | Famille | Force (1-5) | État produit | Ambiguïtés |
|---|---|---|---|---|
| `site_reserve.lifted_at` renseigné (levée datée) | reservation | 5 | `resolved` | Aucune — signal structurel daté. Non observé sur OCEF mais le plus fiable par nature. |
| `site_reserve.status = cancelled` / `site_actions.status = cancelled` | reservation / action | 5 | `resolved` (annulé = fin de vie) | cancelled ≠ done sémantiquement ; le porteur d'état les fusionne en `resolved`, la nuance reste dans le label. |
| `site_actions.status = done` (objet matérialisé) | action | 4 | `resolved` **de l'objet**, pas forcément du sujet | Un sujet peut avoir d'autres objets ouverts → ne conclure `resolved` au niveau sujet que si TOUS les objets ouverts du sujet sont clos (§4). |
| `document_status = done` | knowledge_fact | 4 | `resolved` | Sur OCEF certains `done` réapparaissent (GDE Busage : done→∅→done) — cohérent avec resolved maintenu. |
| `document_status = done` | action / observation | 4 | `resolved` | Rare (famille porte rarement le statut) mais fiable quand présent. |
| `document_status = cancelled` | toute | 4 | `resolved` | — |
| Texte de résolution (« levé », « réalisé », « nettoyé ») sans statut structuré | observation | 3 | `strong_derived` → `resolved` **uniquement si** convergence avec un autre signal (§4) ; sinon `unknown` | Risque de faux positif : « travaux à réaliser » contient « réalis… ». Interdiction d'inférer resolved sur le seul texte. |
| `document_status = in_progress` / `planned` | knowledge_fact / action | 3 | `open` | in_progress est un vrai signal d'activité → `open`, pas `unknown`. |
| `document_status = non_compliant` | observation / non_conformity | 4 | `open` (aggravé) | État ouvert renforcé. |
| Occurrence présente, `document_status = ∅`, aucun objet, aucun texte | toute opérationnelle | 1 | `unknown` | **Cas majoritaire OCEF.** Ne JAMAIS mapper vers `open` par défaut. |
| Famille person / company uniquement | person/company | 0 | `unknown` (état non applicable) | Exclu des métriques ; état non pertinent. |
| Absence totale d'occurrence dans le PV | — | 0 | aucun signal → pas d'état pour ce PV (gap, cf §6) | Absence ≠ résolution (invariant). |

### Règle de priorité d'agrégation (un PV → un état)

Pour un sujet donné dans un PV, appliquer dans l'ordre (le premier qui matche gagne) :

1. **Signal terminal structurel** (force 5-4) présent → `resolved`.
   *Nuance objet vs sujet* : si le signal est un objet matérialisé `done`, appliquer la règle §4 (tous objets ouverts clos ?). Sinon rester `open`/`unknown`.
2. Sinon, **signal d'activité** (`in_progress`, `planned`, `non_compliant`, ou objet matérialisé ouvert) présent → `open`.
3. Sinon, **résolution dérivée du texte seul** → `strong_derived` : promue en `resolved` seulement si convergence (§4), sinon → `unknown`.
4. Sinon (`∅` partout, aucune preuve) → `unknown`.

Principe : **le signal le plus fort et le plus structuré l'emporte**, jamais la famille dominante ni le pire statut. Cela remplace à la fois `aggregateByCanonical` (worst-status) et le tri par famille de `getCanonicalSubjectLife`.

---

## 4. Résolution explicite vs implicite

Trois niveaux, avec règle de promotion :

- **EXPLICIT_RESOLUTION** (force 4-5) — signal structurel fort :
  - `site_reserve.lifted_at` renseigné, ou `site_reserve/site_actions.status ∈ {done, cancelled}`, ou `document_status ∈ {done, cancelled}`.
  - Produit `resolved` directement.
  - Contrainte **objet ≠ sujet** : un objet matérialisé `done` ne résout le *sujet* que si le sujet n'a plus aucun objet matérialisé ouvert ET aucune proposition `open/in_progress` dans le même PV. Sinon le PV reste `open` (un objet clos, d'autres ouverts).

- **STRONG_DERIVED_RESOLUTION** (force 3) — famille dérivée + convergence :
  - Ex. `knowledge_fact` avec `document_status = done` **et** label/texte convergent (« réalisé », « accès livré »). Le statut structuré est ici le signal primaire ; le texte confirme.
  - Un texte « réalisé » **sans** aucun statut structuré ne suffit **jamais** à produire `resolved` seul → reste `unknown`. (Anti-faux-positif : garde contre « travaux à réaliser », « reste à lever ».)

- **NO_RESOLUTION_SIGNAL** (force 0-1) — absence :
  - `∅` partout, ou sujet simplement non mentionné.
  - Produit `unknown` (si mentionné) ou aucun état (si absent). **Jamais `resolved`, jamais `open` par défaut.**
  - Invariant : l'absence n'est jamais une résolution implicite (doctrine dépôt + note migration 291).

Règle cardinale : **une résolution implicite ne s'infère pas de « réalisé » sans contexte structurel.** Le texte confirme un statut, il ne le crée pas.

---

## 5. NEW_CYCLE — discriminants

Sur OCEF, la récurrence structurelle existe : « Essais plateforme du 30/03 » (daté dans le label), « Visite mairie », « Rapport G3 » (chaque avis G3 = un épisode). Le critère **n'est pas le temps écoulé**.

Discriminants opérationnels (NEW_CYCLE si au moins un est vrai) :

1. **Indicateur de label daté / référencé** — le label contient une date ou une référence d'instance unique (« réunion du 15/01 », « Essais du 30/03 », « situation n°7 », « Avis G3 — essais du … »). Chaque instance est une identité distincte : réunion du 15/01 ≠ réunion du 15/02. → NEW_CYCLE à chaque nouvelle instance.
2. **Indicateur structurel de gabarit** — le sujet est de famille `deadline` et de nature récurrente (situation mensuelle, réunion périodique, inspection). Chaque occurrence honorée puis re-planifiée = cycle distinct, pas une réouverture. C'est précisément pourquoi `deadline` est déjà dans `STAGNATION_INELIGIBLE` : le statut « stable » d'une échéance récurrente est un artefact de répétition.
3. **Silence long + réapparition APRÈS résolution avérée d'une instance** — un sujet-gabarit résolu (instance N close), silencieux, puis re-mentionné avec une nouvelle échéance/date → nouvelle instance = NEW_CYCLE, **pas** REOPEN.

Contre-exemple (NE PAS classer NEW_CYCLE) : un sujet de travaux unique (« Zone déshuileur », « Raccordement lagunage ») qui oscille in_progress/done/in_progress dans le temps → même identité longitudinale, transitions ordinaires (CONTINUATION / REOPEN), jamais NEW_CYCLE.

Limite honnête : les discriminants 1 et 3 exigent une analyse de label (date/référence dans le texte) et une notion de « nature récurrente » qui n'est pas stockée aujourd'hui (`is_recurring` n'existe pas). En V1, le discriminant 2 (famille deadline) est le seul **déterministe et immédiatement disponible**. Les discriminants 1/3 sont réalisables par heuristique de label (regex date) en V1, mais avec un rappel limité.

---

## 6. Moteur de transition unifié + tables de vérité

Un **seul** moteur pur remplace `computeCanonicalTransition` (canonical-transitions.ts) et `computeHistoryTransition` (pv-history.ts).

```
computeTransition(
  prevResolved: boolean | null,          // état résolu au dernier PV où le sujet était présent
  hasGap: boolean,                        // au moins un PV sans mention entre prev et curr
  currSignal: 'open' | 'resolved' | 'unknown',   // état agrégé du PV courant (§3)
  isNewCycle: boolean                     // discriminant §5
) -> 'CONTINUATION' | 'REPEAT_WITHOUT_CHANGE' | 'REAPPEARANCE'
   | 'REOPEN' | 'NEW_CYCLE' | 'RESOLVED' | 'NOT_MENTIONED'
```

Notes de sémantique :
- `prevResolved` remplace le `fromStatus` brut : il porte l'état *dérivé* du PV précédent, pas un `document_status` cru. C'est ce qui corrige D1 : le gap ne détruit plus l'information d'état antérieure.
- `currSignal = 'unknown'` est traité comme « pas de changement observable » : il ne peut ni résoudre ni rouvrir ; il maintient l'état antérieur (REPEAT_WITHOUT_CHANGE ou REAPPEARANCE selon le gap).
- `NOT_MENTIONED` reste **calculé, jamais stocké** (invariant dépôt) : c'est le verdict quand le sujet est absent du PV courant.

### Hiérarchie (ordre d'évaluation)

1. `isNewCycle = true` → **NEW_CYCLE** (stoppe ici).
2. Sujet absent du PV courant → **NOT_MENTIONED** (stoppe ici ; absence ≠ résolution).
3. `prevResolved = true` ET `currSignal = open` → **REOPEN** (avec ou sans gap : un sujet résolu redevenu actif est une réouverture).
4. `prevResolved = false/null` ET `hasGap` ET `currSignal ∈ {open, unknown}` → **REAPPEARANCE**.
5. `prevResolved = false/null` ET `currSignal = resolved` → **RESOLVED**.
6. `prevResolved = true` ET `currSignal ∈ {resolved, unknown}` → **REPEAT_WITHOUT_CHANGE** (reste résolu).
7. Sinon (pas de gap, `currSignal = open`, `prevResolved = false/null`) → comparer la signature métier :
   - signature changée → **CONTINUATION**
   - signature identique → **REPEAT_WITHOUT_CHANGE**

### Table de vérité (validée contre les cas OCEF §8)

| prevResolved | gap | currSignal | isNewCycle | → transition |
|---|---|---|---|---|
| null (1er PV) | – | open | non | (première occurrence : pas de transition) |
| false | non | open | non | CONTINUATION (sig. changée) / REPEAT_WITHOUT_CHANGE (sig. identique) |
| false | non | resolved | non | **RESOLVED** |
| false | non | unknown | non | REPEAT_WITHOUT_CHANGE |
| true | non | open | non | **REOPEN** |
| true | non | resolved | non | REPEAT_WITHOUT_CHANGE |
| true | non | unknown | non | REPEAT_WITHOUT_CHANGE (reste résolu) |
| false/null | oui | open | non | **REAPPEARANCE** |
| false/null | oui | unknown | non | **REAPPEARANCE** |
| false/null | oui | resolved | non | RESOLVED (réapparu ET résolu → l'état final prime : RESOLVED) |
| true | oui | open | non | **REOPEN** (corrige D1 : plus jamais « réapparu » ici) |
| true | oui | unknown | non | REPEAT_WITHOUT_CHANGE (reste résolu, simplement re-vu) |
| true | oui | resolved | non | REPEAT_WITHOUT_CHANGE |
| * | * | * | oui | **NEW_CYCLE** |
| * (présent avant) | – | (absent du PV courant) | non | **NOT_MENTIONED** |

Différence clé vs la table proposée dans le prompt : la ligne « resolved | oui | resolved → REAPPEARANCE » a été corrigée en **REPEAT_WITHOUT_CHANGE**, car un sujet résolu re-mentionné comme résolu n'est pas une réapparition significative (il ne déplace pas LMCA, §10). REAPPEARANCE est réservé au retour d'un sujet **non résolu**.

---

## 7. Correction conceptuelle de D1

Défaut D1 actuel (`pv-history.ts:85`) :
```
export function computeHistoryTransition(family, fromStatus, toStatus, hasGap) {
  if (hasGap) return 'réapparu'   // ← court-circuite tout état antérieur
  ...
}
```
Problème : `hasGap` est évalué **avant** toute considération de l'état antérieur. Un sujet `done` puis absent puis re-mentionné actif est étiqueté `réapparu`, effaçant le fait qu'il s'agit d'une **réouverture** (signal opérationnel fort). Cas OCEF concret : « GDE - Busage Provisoire » done (02/04) → absent/∅ (22/04) → done (30/04) : le gap ne doit pas produire « réapparu » alors que le sujet reste résolu.

Correction conceptuelle (sans code) :
- Le gap **ne doit plus être le premier discriminant**. Il devient un modificateur secondaire, après avoir établi `prevResolved` et `currSignal`.
- `prevResolved` doit être **l'état dérivé du dernier PV présent** (pas le `document_status` brut de la proposition précédente, qui peut être `∅`). Cela exige de calculer l'état par PV (§3) puis de propager le dernier état *connu non-unknown* comme référence — un `∅` intermédiaire ne réinitialise pas l'état antérieur.
- Ordre correct : NEW_CYCLE → NOT_MENTIONED → REOPEN (prevResolved && open) → REAPPEARANCE (¬prevResolved && gap) → RESOLVED → REPEAT/CONTINUATION.
- Résultat : `réapparu`/REAPPEARANCE n'est produit **que** pour un sujet non résolu revenant après gap ; un sujet résolu revenant actif produit REOPEN ; un sujet résolu revenant résolu produit REPEAT_WITHOUT_CHANGE.

Corollaire : `pv-comparison.ts` (`computeTransition`) et `canonical-transitions.ts` (`computeCanonicalTransition`) doivent être **remplacés par le moteur unifié**, sinon l'incohérence à deux moteurs persiste.

---

## 8. Cas terrain OCEF

Site OCEF Compostage, 9 PV canoniques : PV001 (12/02), PV002 (12/03), PV003 (19/03), PV005 (02/04), PV006 (16/04), PV007 (22/04), PV008 (30/04), PV009 (02/07), PV010 (16/07). (PV004 absent.)

| Sujet | PV/date | famille(s) | document_status | objet matérialisé | signal résolution ? | état canonique attendu | transition attendue | justification |
|---|---|---|---|---|---|---|---|---|
| GDE - Busage Provisoire | 12/03 | knowledge_fact | done | — | EXPLICIT (done) | resolved | RESOLVED | premier done |
| GDE - Busage Provisoire | 22/04 | knowledge_fact | ∅ | — | NO_SIGNAL | unknown | REPEAT_WITHOUT_CHANGE | ∅ ne rouvre pas un resolved |
| GDE - Busage Provisoire | 30/04 | knowledge_fact | done | — | EXPLICIT | resolved | REPEAT_WITHOUT_CHANGE | reste résolu (corrige D1 : pas « réapparu ») |
| Mise en place couche de forme (GNT) | 12/02 | knowledge_fact | ∅ | — | NO_SIGNAL | unknown | (1ère occ.) | présent, non qualifié |
| Mise en place couche de forme (GNT) | 12/03 | knowledge_fact | done | — | EXPLICIT | resolved | RESOLVED | passe à done |
| Mise en place couche de forme (GNT) | 02/04 | knowledge_fact | done+done+in_progress | — | mixte | open | REOPEN | in_progress présent → activité rouvre le sujet |
| Mise en place couche de forme (GNT) | 22/04 | knowledge_fact | ∅ | — | NO_SIGNAL | unknown | REPEAT_WITHOUT_CHANGE | ∅ maintient |
| Mise en place couche de forme (GNT) | 30/04 → 16/07 | knowledge_fact | done | — | EXPLICIT | resolved | RESOLVED puis REPEAT | re-résolu et maintenu |
| Zone déshuileur | 16/04 | action+knowledge_fact | ∅ / done | action open | mixte (done kf) | open | (1ère occ.) | apparaît ; action ouverte → open malgré kf done |
| Zone déshuileur | 30/04 | knowledge_fact ×2 | in_progress | action open | activité | open | CONTINUATION | en cours |
| Zone déshuileur | 16/07 | knowledge_fact ×2 | in_progress + done | action open | mixte | open | CONTINUATION | done partiel mais action encore ouverte → sujet open (§4 objet≠sujet) |
| Transmission FT Matériaux & Équipements | 12/02 | action | ∅ | — | NO_SIGNAL | unknown | (1ère occ.) | action sans statut |
| Transmission FT … | 03/19,04/02,04/22,04/30 | action/kf | ∅ | — | NO_SIGNAL | unknown | REPEAT_WITHOUT_CHANGE ×N | famille action ne porte jamais le statut → jamais résolue à tort |
| Transmission FT … | 02/07 | knowledge_fact | ∅ | — | NO_SIGNAL | unknown (gap : absent en action) | REAPPEARANCE ou REPEAT | présent mais non qualifié |
| Transmission FT … | 16/07 | knowledge_fact | planned | — | activité | open | REOPEN/CONTINUATION | passe planned → devient open |
| Nettoyage et entretien des accès | 12/02 → 30/04 | observation | ∅ (toutes) | — | NO_SIGNAL | unknown ×7 | REPEAT_WITHOUT_CHANGE | observation périodique jamais qualifiée → jamais résolue implicitement |
| Nettoyage et entretien des accès | après 30/04 | — | absent | — | absence | (aucun) | NOT_MENTIONED | absence ≠ levé |
| Raccordement sur le lagunage | 16/04 → 07/02 | knowledge_fact | ∅ / in_progress | — | activité intermittente | open | CONTINUATION | in_progress = activité |
| Raccordement sur le lagunage | 16/07 | knowledge_fact | planned | — | activité | open | REPEAT_WITHOUT_CHANGE | reste ouvert |
| Coordination LOT01/LOT02 | 12/02 → 04/02 | knowledge_fact | ∅ | — | NO_SIGNAL | unknown | REPEAT | jamais qualifié |
| Coordination LOT01/LOT02 | 16/04 | action | ∅ | — | NO_SIGNAL | unknown | REPEAT (même identité, famille change) | changement de famille ≠ nouveau cycle |
| Coordination LOT01/LOT02 | après 30/04 | — | absent | — | absence | (aucun) | NOT_MENTIONED | disparaît |
| Rapport G3 Purge Complémentaire | 19/03 → 16/07 | action/kf/observation | ∅ / in_progress | — | activité intermittente | open | CONTINUATION | sujet composite multi-familles, reste ouvert |
| Essais plateforme du 30/03 | 02/04 → 16/07 | knowledge_fact | done/in_progress | — | label daté | (open/resolved) | NEW_CYCLE candidat | label contient une date d'instance → discriminant §5.1 |
| BECIB / Mme ROUSSEL / DUMEZ … | tous PV | person/company | ∅ | — | N/A | unknown (non applicable) | exclus du modèle d'état | acteurs, jamais résolus |

Enseignements terrain :
- La **majorité des états est `unknown`** (document_status absent). Un modèle qui force `open` produit un faux « tout est ouvert ».
- Le seul signal terminal réel sur OCEF est `document_status = done` sur `knowledge_fact`. Les objets matérialisés n'apportent rien ici (tout open).
- Les **oscillations intra-PV** (done + in_progress même date) exigent l'agrégation §3, pas le choix d'une proposition unique.
- **Objet ≠ sujet** est réel : « Zone déshuileur » a du `done` (knowledge_fact) mais une action encore `open` → le sujet reste ouvert.
- Le cas D1 est **présent** dans les données (GDE Busage, couche de forme) : gap avec état résolu maintenu.

---

## 9. Stockage vs dérivation — décision

| Critère | A — recalcul pur | B — persisté sur canonical_subject | C — persisté par occurrence |
|---|---|---|---|
| Auditabilité | Moyenne : verdict reproductible mais invisible en base | Faible : un seul état courant, historique perdu | **Forte** : chaque PV porte son état observé, traçable |
| Idempotence après réextraction | **Forte** : rien à invalider | Faible : état courant à recalculer + risque de dérive | Forte : recalcul par occurrence, borné au PV réextrait |
| Recalcul après re-canonicalisation (fusion/split) | **Forte** : recalcul complet automatique | Faible : état à re-propager sur le winner | Forte : occurrences re-rattachées, état recalculé localement |
| Coût requête (lecture) | Élevé : recharge toutes les propositions + objets à chaque lecture | **Faible** : 1 colonne | Moyen : lecture des occurrences (déjà nécessaire pour la timeline) |
| Simplicité | Élevée conceptuellement, mais duplique le calcul partout | Trompeusement simple, viole « pas de source de vérité mutable » | Moyenne : une écriture au moment de l'extraction |
| Compatibilité P1-4 (LMCA) | Faible : LMCA recalculé à chaque fois | Faible : LMCA courant seul | **Forte** : l'état par occurrence permet de dater précisément le changement (§10) |

**Recommandation : Option C**, avec réserve.

- C aligne le porteur d'état sur l'architecture existante : `canonical_subject_occurrence` porte déjà `historical_pdf` (199 lignes OCEF) mais **sans champ d'état de résolution**. Le P0 (§11) consiste à ajouter ce champ, pas à créer une table.
- C respecte la doctrine « le cache ne doit jamais devenir source de vérité » : l'état par occurrence est un **dérivé matérialisé** des propositions + objets, recalculable à tout moment (fallback = reconstruction). Il accélère la lecture sans devenir canonique.
- L'**état courant du sujet** reste **dérivé** de la dernière occurrence non-`unknown` (pas un champ mutable sur `canonical_subject`) — on ne prend donc PAS l'option B pour l'état courant.
- Réserve : C n'a de valeur que si l'écriture de l'état se fait au bon moment (post-extraction / post-canonicalisation) et se recalcule sur re-extraction. Sinon, préférer A (recalcul pur) plutôt qu'un C périmé. **A est le fallback obligatoire de C.**

En clair : **C pour la persistance de l'état par occurrence + dérivation pure de l'état courant et des transitions**. Ni B, ni A seul.

---

## 10. Compatibilité P1-4 (LMCA)

Le modèle permet, sans implémenter P1-4 :

- `lastSeenAt` = date du PV de la dernière occurrence réelle (déjà calculé partout ; trivial).
- `lastMeaningfulChangeAt` = date du PV où **l'état agrégé (§3) ou la signature métier a changé de façon significative**. L'état par occurrence (Option C) fournit exactement la séquence d'états nécessaire.

Correspondance transition → déplacement de LMCA :

| Transition | Déplace LMCA ? | Raison |
|---|---|---|
| CONTINUATION (signature changée) | Oui | changement métier réel |
| CONTINUATION (sans changement notable) | **Non** | même signature |
| REPEAT_WITHOUT_CHANGE | **Non** | par définition |
| REOPEN | **Oui** | passage resolved → open = évolution forte |
| RESOLVED | **Oui** | passage open → resolved = évolution forte |
| REAPPEARANCE | **Oui** | retour après absence = information nouvelle |
| NEW_CYCLE | Oui | nouvelle instance = nouvel événement |
| NOT_MENTIONED | Non (calculé, pas un événement) | absence ≠ changement |

Le moteur unifié (§6) produit directement le booléen « meaningful » par transition, ce qui alimente `computeNativeChangeMetrics` / la primitive stagnation de `canonical-subject-life.ts` de façon cohérente — en remplaçant la signature actuelle `statut|matSig` (qui traite `∅` comme un état plein) par l'état agrégé `open/resolved/unknown`, où `unknown` n'est **pas** un changement.

---

## 11. P0 minimal proposé

Périmètre strict pour lever P1_3_MODEL_GAP, sans élargir :

1. **Fonction pure d'agrégation d'état de PV** (`aggregatePvState`) : (propositions du sujet dans un PV + objets matérialisés liés) → `open | resolved | unknown`, selon §3/§4. Testable en isolation, zéro DB. **Supprime le fallback `?? 'open'`.**
2. **Moteur de transition unifié** (`computeSubjectTransition`, §6) remplaçant `computeCanonicalTransition`, `computeHistoryTransition` et `computeTransition`. Pur, table de vérité §6 comme contrat de test.
3. **Discriminant NEW_CYCLE V1 déterministe** : famille `deadline` (disponible) + heuristique de label daté (regex date dans le label). Rappel limité assumé, documenté.
4. **Porteur d'état par occurrence (Option C)** : colonne `resolution_state text CHECK (open/resolved/unknown)` sur `canonical_subject_occurrence`, alimentée au moment de la (re)construction de la mémoire, recalculable (fallback = recalcul pur). Migration **additive** (nullable), donc autorisée sans validation supplémentaire — mais **hors périmètre P1-3A** (audit only) : à décider en P1-3B.
5. **État courant dérivé** : dernière occurrence non-`unknown` → pas de champ mutable sur `canonical_subject`.

Ce que le P0 **ne fait pas** : pas d'analyse Gemini de texte de résolution (le `strong_derived` reste borné à la convergence statut+texte déterministe) ; pas de champ `is_recurring` ; pas de refonte des surfaces de lecture.

---

## Verdict

**P1_3A_READY**

Le modèle d'état minimal (`open` / `resolved` / `unknown`), la matrice d'agrégation multi-familles, la distinction résolution explicite / dérivée / absente, les discriminants NEW_CYCLE, le moteur de transition unifié (avec table de vérité validée sur OCEF) et la décision de stockage (Option C + dérivation, fallback A) sont définis et confrontés aux données terrain réelles.

Réserves explicites, non bloquantes pour la conception :
- Sur OCEF, **le seul signal terminal réel est `document_status = done` sur knowledge_fact** ; les objets matérialisés n'apportent aucun signal (tout open, aucune réserve levée). Le modèle est correct mais sa *puissance* dépend d'un enrichissement futur des signaux terminaux d'action/observation — sans quoi la majorité des états restera `unknown` (ce qui est le comportement honnête attendu).
- Le discriminant NEW_CYCLE textuel (label daté) a un rappel limité en V1 déterministe.
- La correction D1 impose de propager `prevResolved` comme *dernier état non-unknown*, pas comme statut brut — point d'attention pour l'implémentation P1-3B.

Le passage à l'implémentation (P1-3B) peut démarrer sur cette base.

---

*HARD STOP — fichier écrit, aucune modification de code, aucune migration, aucun commit.*
