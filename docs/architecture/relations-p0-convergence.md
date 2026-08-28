# Relations P0 — convergence de la chaîne de vérité des relations

**Objectif (Vincent) : fermer la chaîne de vérité des relations comme on l'a fait pour le longitudinal.
PAS « faire fonctionner Dépendances ». Doctrine : faux négatif > faux positif, preuve obligatoire,
pas de `relates_to` fourre-tout, une relation IA candidate n'acquiert jamais silencieusement le statut de vérité.**

Chaîne cible : `preuve PV/CR → relation candidate → canonical subjects A/B → relation canonique + provenance
→ éventuelle validation → consommateurs → (seulement ensuite) ce que l'utilisateur voit`.

---

## Phase 1 — Le moteur occurrence-first dormant (audit READ-ONLY, empirique)

### 1.1 Pourquoi il existe sans être appelé
`produceRelationsFromOccurrences` (écrit `canonical_subject_links`, mig 316) a été construit en P0-B1
comme **successeur terrain-first** de `produceRelationsForRun` (écrit `subject_thread_links`, legacy mig 269).
La bascule dans `review-actions.ts:1141` **n'a jamais été faite** : l'import PV appelle toujours l'ancien
moteur. Ce n'est pas une dette cachée dangereuse — c'est une **migration inachevée** vers le moteur le PLUS
strict.

### 1.2 Ce qu'il infère, avec quel niveau de preuve — distingue-t-il causalité et cooccurrence ?
Les deux moteurs partagent le même qualifieur `qualifyLinkCandidate` (Gemini light, temp 0) et la même config
(`minCooccurrences`, `minLift`, `minLlmConfidence 0.70`). **Différence décisive** :
- `produceRelationsForRun` (branché) **écrit `relates_to`** → d'où les 30/51 liens « associé à » en base.
- `produceRelationsFromOccurrences` (dormant) applique une **whitelist serveur qui REJETTE `relates_to`**
  (`ALLOWED_RELATION_TYPES` = requires/enables/validates/causes/replaces) et **exige une preuve**
  (`canonical_subject_link_evidence.evidence_text` NOT NULL). Il ne garde que des liens **causaux directionnels prouvés**.

Le prompt (`qualify-link-candidates.ts`) porte explicitement la doctrine : « la cooccurrence seule N'EST PAS une
relation métier », règle anti-contingence (« Y si X non fait » → jamais directionnel), « n'utilise aucune
connaissance réglementaire absente des extraits », « préfère no_relation à une relation incertaine ».

### 1.3 Risque de faux positifs à l'échelle — mesuré
Dry-run READ-ONLY sur **OCEF Compostage** (`2c939e67`, corpus le plus riche : 218 occurrences, 67 sujets,
1690 paires), config **assouplie** (`minCooccurrences=2`) pour stress-test :

| Indicateur | Valeur |
|---|---|
| Paires candidates | 1690 (615 sous le seuil de cooccurrence, 8 sous lift) |
| Candidats soumis à Gemini (top 30) | 30 |
| **no_relation** | **24 (80 %)** |
| relates_to (rejeté whitelist) | 6 (20 %) |
| directional écrit | **0** |
| faux positifs | **0** |

Même sur des paires à **lift 5.0 / confiance 1.0** (deux périodes d'intempéries ; compactage & déshuileur ;
raccordement lagunage & déshuileur), Gemini répond `no_relation` avec justification « cooccurrence fortuite,
aucune dépendance/causalité prouvée ». **Le moteur dormant ne fabrique pas de relations** : il distingue
correctement cooccurrence et dépendance. C'est exactement la doctrine « faux négatif préférable au faux positif ».

**Verdict Phase 1 : le moteur dormant est SÛR contre les faux positifs — c'est le bon moteur, pas un danger.**
Le brancher réduirait le bruit (fin des `relates_to`) mais produirait **très peu** de liens (0 sur ce corpus) —
honnête, car ce corpus contient peu de dépendances causales prouvables. Le brancher n'est donc **pas urgent**
tant que le corpus réel est vide (garde-fou C).

---

## Phase 2 — Inventaire producteurs / consommateurs (requirement 1)

| Table | Producteurs | Consommateurs (lecture affichage) |
|---|---|---|
| **`subject_relation`** (mig 145, BLOQUE, subjects **opérationnels**) | `createSubjectRelationAction` (humain) | `SubjectRelationControls` sur `/sites/[id]/subjects/[subjectId]` (fiche legacy). **0 ligne en base.** |
| **`subject_thread_links`** (mig 269, threads→canonical) | `produceRelationsForRun` (AUTO, cooccurrence, écrit `relates_to`) ; `createCanonicalSubjectLink`/`createSubjectLink` (humain) | Onglet **Suivi › Dépendances** (`getSiteDependencyGraph`, confirmed) ; **Carte** (`getSiteKnowledgeGraph` §2a) ; **fiche canonique** + **graphe mobile** (`getCanonicalSubjectLife`) ; badge Lignes de vie (`getSuggestedLinkCountsBySite`) ; validation `subjects/page.tsx` |
| **`canonical_subject_links`** (mig 316, canonical natif + preuve) | `confirmSiteRelation` (Copilote RELATION_CLAIM, confirmed) ; `produceRelationsFromOccurrences` (**dormant**) | **Carte uniquement** (`getSiteKnowledgeGraph` §2b) ; mutation merge (`merge-actions.ts`) |

**Fragmentation confirmée** : le meilleur modèle (`canonical_subject_links`) n'est lu que par la Carte ;
l'onglet « Dépendances » et la fiche lisent le legacy `subject_thread_links`.

---

## Phase 3 — Les quatre questions de Vincent (réponses)

**1. Quelle est l'unique table de vérité ? → `canonical_subject_links` (mig 316).**
C'est la seule qui soit canonical-native, à preuve obligatoire, anti-`relates_to`, alignée sur la vérité
occurrence-first. `subject_thread_links` et `subject_relation` = legacy à faire converger (pas encore supprimables,
requirement 10).

**2. Qui a le droit d'y écrire et sous quelles preuves ?**
- `confirmSiteRelation` (Copilote RELATION_CLAIM) : `status='confirmed'`, evidence = phrase verbatim de l'utilisateur.
- `produceRelationsFromOccurrences` (dormant) : `status='suggested'`, evidence = extrait d'occurrence, whitelist causale, conf ≥ 0.70.
- Merge : réécriture technique, pas création métier.
- Invariant : preuve `evidence_text` NOT NULL toujours ; jamais `confirmed` sans acte humain ou affirmation directe.

**3. Tous les consommateurs lisent-ils cette même vérité ? → NON.**
Seule la Carte lit `canonical_subject_links`. L'onglet Dépendances et la fiche lisent `subject_thread_links`.
C'est l'écart de vérité à fermer (comme pvLastDelta pour le longitudinal).

**4. Assez de relations réelles pour justifier une UX globale ? → NON.**
Corpus réel : BELLA 0, OCEF prod (`06c62e48`) 0, PETRO 1 (semé par test). Les 51 `subject_thread_links` sont
tous sur une fixture de recette périmée (`2c939e67`). **Une UX réseau/treemap/drag&drop sur ce corpus afficherait
du vide.** → Conformément à ta doctrine, **masquer l'onglet Dépendances est une réussite du lot, pas un échec.**

---

## Phase 4 — Convergence appliquée ce lot (garde-fou C respecté)

Vu Q4 = NON, on ne branche PAS le moteur dormant ni ne migre en masse les lectures (ce serait bâtir de la
plomberie pour 0 donnée). Actions retenues :

1. **Masquer l'onglet « Dépendances » de la sous-navigation Suivi** (requirement 3 : l'onglet ne doit plus
   exposer `subject_thread_links` ni un écran vide). Réversible ; deep-link `?view=deps` conservé sans être
   discoverable.
2. **Conserver la fiche sujet** (desktop `historique/sujets/[id]` + graphe mobile `SubjectContextGraph`) comme
   endroit naturel des « Liens » — n'apparaît déjà que s'il existe des liens confirmés (`confirmed.length === 0
   → return null`). Rien à masquer côté fiche : elle est intrinsèquement vide-safe.

### Reste (hors périmètre de ce lot, sur GO ultérieur — corpus doit exister d'abord)
- Brancher `produceRelationsFromOccurrences` à la place de `produceRelationsForRun` dans `review-actions.ts`
  (moteur prouvé sûr) → l'automatique alimenterait `canonical_subject_links` (causal, avec preuve, jamais `relates_to`).
- Migrer les lectures fiche/onglet de `subject_thread_links` vers `canonical_subject_links`.
- Filtrer/retirer les `relates_to` du corpus fixture (ne PAS migrer aveuglément les 51 liens, ni promouvoir le lien PETRO de test).
- Supprimer les tables legacy seulement après preuve zéro consommateur (requirement 10).
La vue réseau globale revient quand MemorIA aura constitué un graphe réel suffisant.

---

## Garde-fous respectés
READ-ONLY pour l'audit (lectures + dry-run sans écriture, `scripts/dry-run-relations-ocef.ts`). Le seul changement
produit de ce lot = masquer un onglet (réversible, aucune donnée touchée). Aucune migration, aucun backfill, aucun
lien fabriqué, moteur dormant compris AVANT toute décision de branchement, `relates_to` non réintroduit.
