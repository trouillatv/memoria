# P1-B — Root cause : fait métier absorbé par l'acteur (Bug A) + non-rapprochement inter-années (Bug B)

Date : 2026-08-27. **READ-ONLY, diagnostic uniquement.** Aucun UPDATE, fusion, rematching, migration.
Sources : `_p1b-trace-mechanism.ts`, `_p1b-thread-detail.ts`, `_p1b-repro-resolver.ts` (reproduction
offline des 4 passes du resolver sur les chaînes réelles). Site Bella Napoli
`cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6`. Runs : 2024-07-19 `684b982b` (matérialisé 00:29),
2025-08-05 `79a735e1` (matérialisé 01:29).

## 0. Correction d'une conclusion P1

Le rapport P1 disait « il n'existe aucun sujet métier 2024 ». **Faux.** Les sujets métier existent
(`Nettoyage conduits…`, `Contrôle des appareils de cuisson…`, `Contrôle système d'extinction (friteuse)`,
… tous `creation_source='historical_pv'`). Le vrai défaut n'est pas leur absence : c'est que
**l'OCCURRENCE du fait 2024 est rattachée au canonical_subject de l'ACTEUR**, pas au sujet métier.
Le symptôme observé (aucune continuité) reste vrai ; sa cause est plus précise que « pas de sujet métier ».

## 1. Où le fait disparaît au profit de l'acteur — PROUVÉ

Les threads sont **correctement séparés dès l'extraction**. Pour chaque acteur, le thread « company »
et le thread du fait métier sont **distincts** (preuve `_p1b-thread-detail.ts`) :

| Acteur (CS) | Thread ACTEUR (company) | Thread FAIT métier (séparé) | Famille du fait |
|---|---|---|---|
| KFT | `5663b3af` | `c7007e35` « Nettoyage conduits… par KFT » | knowledge_fact |
| MIES | `a8dfb7b5` | `b5215bff` friteuse, `81eed86d` extincteurs | knowledge_fact ×2 |
| Bureau Veritas | `6f0e6012` | `2ac456a4` cuisson, `d5971c29` élec. | knowledge_fact ×2 |
| DSCGR | `17cd3ba5` | `3703e1b3` « Validation issue mall » | decision |
| CAPSE NC | `358feb56` | `09d989a8` « panneau + marquage » | action |
| Velayoudon | `e1148b60` | `d020a87a` « Récupération huiles » | knowledge_fact |
| VHZ réfrigération | `4a3a5c82` | `07974f13` « Contrôles climatisation » | knowledge_fact |

⇒ **Le défaut n'est PAS à l'extraction, ni dans `reconcileSubjectThreads`, ni dans `tryActorAutoLink`.**
Le thread métier existe, propre. Il est **rattaché au CS de l'acteur au moment de la matérialisation**,
par `reconcileHistoricalPvCanonicalSubjects()` (`lib/db/canonical-subject-historical-reconcile.ts`),
qui résout chaque thread métier contre un pool de candidats **incluant les CS acteurs**.

## 2. Bug A — le fait métier est résolu SUR le sujet acteur

`reconcileHistoricalPvCanonicalSubjects` enchaîne des passes de résolution (`resolveCanonicalSubjectReference`
Phase 1 déterministe → `matchExistingSubject` Phase 1.5 LLM → `analyzeSubjectPair` Phase 1.6 → clustering
Phase 2 création). **Toutes utilisent comme candidats l'ensemble des `canonical_subject` actifs — acteurs
compris.** Le garde-fou « person/company hors périmètre » ne saute que les *propositions* acteurs ; il ne
retire jamais les *sujets* acteurs du pool contre lequel les faits sont résolus.

Reproduction offline des 4 passes sur les chaînes réelles (`_p1b-repro-resolver.ts`, pool = 7 acteurs seuls,
état du 2024) :

| Cas (fait) | Passe qui matche | Résultat |
|---|---|---|
| Bureau Veritas / cuisson | **1.5 ancre lexicale** (`strongContainmentMatch` : « Veritas » = 7 car. ≥ 7, contenu dans le fait) | resolved → « Bureau Veritas » |
| KFT / nettoyage | déterministe = **not_found** | (absorbé plus loin) |
| MIES / friteuse | déterministe = **not_found** | (absorbé plus loin) |
| DSCGR / issue | déterministe = **not_found** | (absorbé plus loin) |
| CAPSE / panneau | déterministe = **not_found** | (absorbé plus loin) |
| Velayoudon / huiles | déterministe = **not_found** | (absorbé plus loin) |
| VHZ / climatisation | déterministe = **not_found** | (absorbé plus loin) |

Deux sous-mécanismes, **même racine (acteur dans le pool)** :

- **Acteur à nom long (token ≥ 7 car.)** → **Phase 1 déterministe, ancre lexicale**. `strongContainmentMatch`
  accepte un token unique ≥ 7 caractères comme discriminant : « Veritas » (7), « Velayoudon » (10) sont
  contenus dans le fait quand le fait les cite. **Bureau Veritas** est absorbé ici (prouvé offline).
- **Acteur acronyme / nom court (KFT, MIES, DSCGR, CAPSE, VHZ)** → **Phase 1.5 LLM `matchExistingSubject`**.
  Preuve par élimination : Phase 1 = not_found (prouvé) ; Phase 1.6 exige un candidat lexical
  (Jaccard normalisé ≥ seuil) et « Récupération des huiles » vs « Velayoudon » = Jaccard 0 → non éligible ;
  reste **uniquement** Phase 1.5, qui envoie au LLM **toute** la liste des CS actifs sans pré-filtre lexical.
  Le LLM, voyant « Récupération des huiles usagées » et le CS « Velayoudon », décide `same_subject` →
  `attach`. C'est le fait collé sur l'acteur.

### Tableau Étape / Fonction / Entrée / Sortie — Bug A

| Étape | Fonction | Entrée | Sortie actuelle | Sortie attendue | Cause |
|---|---|---|---|---|---|
| Extraction 12c | `extract-historical-pv` (insert CS acteur) | orphelin company « KFT » | CS acteur « KFT » créé (company_id=null, no_match) | idem (acteur légitime) | OK |
| Matér. Phase 1 | `resolveCanonicalSubjectReference` → `matchCanonicalSubjects` | fait « …par Bureau Veritas… » + pool incluant CS « Bureau Veritas » | resolved → CS acteur (ancre « Veritas ») | not_found → création sujet métier | pool inclut les acteurs |
| Matér. Phase 1.5 | `matchExistingSubject` (LLM, liste = TOUS les CS actifs) | fait « Récupération huiles » + CS « Velayoudon » dans la liste | `attach` → CS acteur | fait jamais proposé contre un acteur | pool LLM inclut les acteurs |
| Occurrence | `ensureHistoricalPdfOccurrences` | thread métier → STV → CS acteur | `canonical_subject_occurrence` sous l'acteur | occurrence sous le sujet métier | hérite du mauvais rattachement |

**Root cause exacte (Bug A)** : `reconcileHistoricalPvCanonicalSubjects` résout les threads métier contre
un pool de `canonical_subject` **qui contient les sujets acteurs**. Dès qu'un fait cite son acteur (par
acronyme ou nom), il est lié au sujet de l'acteur — par l'ancre lexicale (nom long) ou par le match LLM
liste-ouverte (acronyme). Le sujet métier propre n'est jamais créé pour ce fait.

- **Surface impactée** : mémoire longitudinale (canonical_subject_occurrence), Évolution, Aperçu, Histoire,
  compteurs « ouverts/récurrents », continuité inter-PV. Les « 25 nouveaux », les faux « toujours ouverts »
  et les lignes de vie cassées en dérivent.
- **Classes de propositions concernées** : `knowledge_fact`, `decision`, `action` (toute famille métier qui
  nomme un acteur). Pas `observation` dans ce corpus. `person/company` = les acteurs cibles.
- **Pourquoi critique sur Géant** : chaque CR/VGP/SSI y cite systématiquement l'organisme de contrôle
  (« vérifié par APAVE / SOCOTEC / DEKRA le … »). Chaque fait de contrôle serait aspiré par l'organisme →
  effondrement généralisé de la continuité, pas un cas isolé.

## 3. Bug B — non-rapprochement inter-années (aucun acteur en cause)

Cas : `Dégagement extérieur du Mall` (2024) vs `Issue de Secours du food court` (2025) — même objet
physique (l'issue du food-court sur le mall), deux formulations. Reproduction (`_p1b-repro-resolver.ts`) :

- `jaccard = 0.000` (seuil 0.35) — **aucun token commun**.
- `strongContainmentMatch = false`.
- `match(2025, pool={Mall 2024}) = not_found`.

Les phases LLM (1.5/1.6) n'ont pas rattrapé : les deux CS sont restés séparés. Le matcher inter-années est
**lexical** ; deux libellés sémantiquement identiques mais lexicalement disjoints ne convergent jamais.

### Tableau Étape / Fonction / Entrée / Sortie — Bug B

| Étape | Fonction | Entrée | Sortie actuelle | Sortie attendue | Cause |
|---|---|---|---|---|---|
| Matér. Phase 1 | `matchCanonicalSubjects` | « Issue de Secours du food court » + CS « Dégagement extérieur du Mall » | not_found (Jaccard 0, pas d'ancre) | resolved / candidat même-objet | matcher purement lexical |
| Matér. Phase 1.5/1.6 | `matchExistingSubject` / `analyzeSubjectPair` | idem | pas de rattachement | rapprochement sémantique | pas d'éligibilité (Jaccard 0) + LLM non concluant |

**Root cause exacte (Bug B)** : le rapprochement inter-années repose sur la similarité lexicale (Jaccard +
ancre containment). Deux dénominations différentes du même objet métier (vocabulaire d'un rédacteur à
l'autre, d'une année à l'autre) restent orphelines. **Indépendant de Bug A** : le corriger ne le résout pas.

- **Surface impactée** : continuité inter-PV, lignes de vie, Évolution.
- **Pourquoi critique sur Géant** : plusieurs rédacteurs / formats (CR, VGP, SSI) → variation lexicale
  massive sur les mêmes équipements ; sans matching sémantique, chaque année repart de zéro.

## 4. Réponses aux questions de cadrage

1. **Moment exact de la bascule** : matérialisation, `reconcileHistoricalPvCanonicalSubjects`, quand le
   thread métier est résolu sur un CS acteur (Phase 1 ancre, ou Phase 1.5 LLM). Jamais à l'extraction.
2. **Nature** : ni thread acteur réutilisé, ni identité de thread incorrecte, ni `tryActorAutoLink`, ni
   règle de matérialisation. C'est **la présence des sujets acteurs dans le pool de résolution des faits**
   + un match (déterministe pour nom long, LLM liste-ouverte pour acronyme).
3. **Familles** : `knowledge_fact`, `decision`, `action`. Pas `observation` ici.
4. **Même chemin ?** : **deux** chemins, même racine. Bureau Veritas = déterministe (ancre « Veritas ») ;
   KFT/MIES/DSCGR/CAPSE/Velayoudon/VHZ = LLM Phase 1.5.
5. **Représentation propre SUJET↔ACTEUR déjà disponible ?** : **oui.** `canonical_subject.company_id/contact_id`
   (mig 299), `canonical_subject_actor_link`, et `canonical_subject_occurrence.entity_ids[]` (ici vide). Le
   modèle sait porter un acteur comme entité liée à un sujet métier ; la réconciliation le court-circuite.

## 5. Proposition P1-C (correctif générique — NON implémenté ici)

**Bug A — retirer les acteurs du pool de résolution des faits.**
Un fait métier ne doit jamais pouvoir se résoudre sur un sujet acteur. Deux briques :

1. **Marquer durablement un CS acteur à sa création** (aujourd'hui rien ne les distingue de façon fiable :
   `company_id` est null quand `tryActorAutoLink`=no_match, et `creation_source` est null par défaut).
   Ajouter un marqueur additif (ex. `canonical_subject.subject_role = 'actor'`, ou `creation_source='actor'`)
   posé en étape 12c `extract-historical-pv` **et** dans `ensureActorCanonicalSubject`. Migration additive,
   non destructive.
2. **Filtrer le pool dans `reconcileHistoricalPvCanonicalSubjects`** (Phases 1, 1.5, 1.6) et, plus
   généralement, dans `resolveCanonicalSubjectReference` quand elle sert à résoudre un thread métier :
   exclure les CS marqués acteur. Un fait qui cite un acteur → ne matche plus l'acteur → tombe en Phase 2 →
   crée/rejoint le vrai sujet métier ; l'acteur est ensuite attaché comme **entité liée**, pas comme sujet.

   - **Risque de sur-fusion** : **réduit** (on retire des cibles de match). Risque résiduel : un fait dont le
     libellé EST le nom de l'acteur et rien d'autre (peu probable pour un fait) créerait un doublon métier
     plutôt qu'une absorption — préférable, et rattrapable par fusion humaine.
   - **Tests de non-régression** : les 7 cas Bella Napoli (fait ne doit PAS résoudre sur l'acteur) ; un cas
     où le libellé métier partage un token ≥ 7 avec un acteur (ex. « Veritas ») → ne matche plus l'acteur ;
     un vrai sujet acteur (proposition company) → continue de créer/retrouver son CS acteur inchangé.

**Bug B — matching inter-années sémantique, borné.**
Le corriger sépément de Bug A. Piste : élargir l'éligibilité des candidats au-delà du Jaccard lexical
(embeddings déjà présents via `embedDocumentChunks` / `knowledge_chunks`, ou un `analyzeSubjectPair`
same-object avec prompt strict), sans abaisser le seuil Jaccard (ce qui provoquerait des sur-fusions
larges). À cadrer comme **P1-C2** distinct, après P1-C1 (Bug A). Ne pas mélanger les deux.

## 6. Interdits respectés

Aucune fusion manuelle, aucun renommage, aucun backfill ciblé, aucune exception CAPSE, aucune règle par
organisme n'est proposée. Le correctif est **structurel** (un acteur cité reste un acteur lié, jamais le
sujet) et **générique** (marqueur + filtre de pool), reproductible sur tout corpus.

**HARD STOP.** P1-B = diagnostic terminé. Rien n'est écrit. Attente GO pour P1-C.
