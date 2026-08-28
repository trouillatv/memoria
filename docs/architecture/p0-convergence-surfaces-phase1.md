# P0 — Convergence des surfaces longitudinales — Phase 1 READ-ONLY

Objectif (Vincent) : supprimer les contradictions utilisateur Aperçu ↔ Histoire **sans** remplacement
mécanique, **sans** nouvelle sémantique, **sans** uniformiser artificiellement les interfaces.
Doctrine : *une trajectoire documentaire = une seule vérité occurrence-first (`buildSiteSubjectCells`/
`getPvDelta`) ; les vues projettent cette vérité différemment mais ne reconstruisent pas une autre
trajectoire depuis `proposals`/`document_status`.* Sonde : `scripts/audit-p0-surfaces.ts`. **READ-ONLY.**

## Tableau de migration par surface

| Surface | Question métier prétendue (UI) | Population + primitive ACTUELLES | Mesure Bella | Équivalent occurrence-first | Projection UI attendue |
|---|---|---|---|---|---|
| **Histoire > Synthèse** (`SyntheseView`) | « ce qui a changé sur le chantier » — labels *sujets apparus / aggravés-réouverts / réalisés-levés / toujours ouverts / non mentionnés* | `getCanonicalDelta` + `computeDeltaSummary` : proposals + `document_status`, **familles person/company/`knowledge_fact` EXCLUES**, **aggravé+réouvert FUSIONNÉS** | 2 apparus · 3 aggravés/réouverts · 0 traités · 3 toujours ouverts · 2 non mentionnés | `getPvDelta` / `cellDeltaTransition` (acteurs exclus seulement, #228) | réouvert(3) · aggravé(0) · nouveau(12) · réapparu(0) · résolu(3) · non-mentionné(2) · maintenu(N). **Jamais fusionné.** |
| **Histoire > Historique PV** (`ActivityMapView`) | « Comparaison des sujets entre les PV historiques importés » | `getActivityMap` : top-8, proposals + `document_status`, `knowledge_fact` exclu | **0 lignes (grille VIDE)** | `buildSiteSubjectCells` (= déjà la source de *Lignes de vie*) | grille runs × sujets complète ; **chaque compteur par PV = population occurrence-first de ce PV**. Forme compacte conservable ; redondance avec *Lignes de vie* à clarifier (P3). |
| **Histoire > Évolution** (`EvolutionView`) | punchlines *« Stabilité / Montée des difficultés / Phase critique / Évolution mixte »* + courbe Tension + « Pic N sujets » | **DEUX sources** : (a) période/silence structurelle sur `getActivityMap` (VIDE) ; (b) `getSiteHealthTimeline` (Tension) | (a) → **« Aucune transition — sujets en cours »** (faux) ; (b) → 7 actifs PV1, 7 PV2, new 7 puis **2** | (a) narration = migrer vers `getPvDelta` ; (b) Tension = **voir décision ci-dessous** | (a) récit occurrence-first cohérent avec le delta ; (b) courbe conservée si contrat clarifié |

Mesure clé : le delta legacy Bella = `{knowledge_fact:3, observation:2, action:5}` → l'exclusion de
`knowledge_fact` seule fait passer « 12 nouveaux » (occurrence) à « 2 apparus » (legacy). Et
`getActivityMap` ne renvoie **aucune** ligne pour Bella → l'activité structurelle (Historique PV +
narration Évolution) est **vide/fausse** là où l'occurrence-first est riche.

## Décision demandée — Évolution + Tension (HARD STOP local)

Vincent : *« une métrique différente peut exister ; une histoire concurrente ne peut pas exister sous
le même vocabulaire. »* Deux composants distincts dans l'onglet Évolution :

**(a) Narration structurelle par période** (punchlines *Stabilité / Montée des difficultés / Phase
critique*). Elle **prétend répondre à « comment le chantier a-t-il évolué »** — la MÊME question que le
delta. Sur `getActivityMap` vide, elle affirme « Stabilité — aucune transition » alors qu'il y a 12
nouveaux + 3 réouverts + 3 résolus. Ce n'est pas une métrique distincte valide : c'est le modèle
legacy qui produit un récit **faux**. → **Verdict : migrer occurrence-first** (le récit « ce qui a
évolué » doit lire `getPvDelta`, réouvert ≠ aggravé, `knowledge_fact` gardé).

**(b) Courbe de Tension** (`getSiteHealthTimeline`). C'est **déjà occurrence-first** (`state_status`
via `fetchSiteHistoricalOccurrences`, même source que Chronologie/Lignes de vie, P0-2d). 7→7 est un
axe **légitimement distinct** (« nombre de concerns opérationnels ouverts ») : une tension stable peut
coexister avec beaucoup d'activité. **MAIS** son exclusion de population se fait encore par **famille**
(`OPERATIONAL_EXCLUDED_FAMILIES` = person/company/`knowledge_fact`), critère **pré-#228** — alors que
l'axe opérationnel post-#228 exclut sur `durableKind=actor` et **garde** `knowledge_fact`. D'où
`new=2` (comme la Synthèse legacy) au lieu de refléter les 12.

→ **Décision produit à trancher (ne pas coder avant ton GO)** :
- **Option T1** — la Tension reste « charge de concerns **opérationnels** » et **assume** d'exclure les
  faits ; on la **renomme/présente comme telle** (ex. « Concerns opérationnels ouverts »), distincte de
  « ce qui a changé ». Cohérent avec « métrique distincte, pas histoire concurrente ». Un knowledge_fact
  « OK » n'ajoute pas de tension — défendable.
- **Option T2** — la Tension s'aligne sur `durableKind` (#228) et compte aussi les faits ouverts
  (ex. « Récupération des huiles usagées » open). Alors 7→7 changerait. Plus cohérent avec le reste,
  mais change une métrique que tu as reconnue comme possiblement valide en l'état.

Recommandation : **T1** (garder l'axe tension tel quel, le nommer explicitement) — c'est le seul endroit
où une population différente est *justifiée*, à condition de ne plus la présenter comme « l'évolution
générale ». La narration (a) migre ; la courbe (b) reste mais est étiquetée comme un axe distinct.

## Ce que P0 NE fait pas
Ne touche pas #229/#230/#231/#233, ni fiches sujet, ni scoring Attention, ni extraction/canonicalisation,
n'ajoute pas la narration P1. `pvLastDelta` (SiteOverview, legacy, non affiché depuis #230) = mort à
retirer en même temps, sans risque.

## Recette prévue (Phase 2, après GO) — Bella + OCEF + PETRO
Par surface : `vérité occurrence → population → catégorie → compteur → sujets constitutifs → texte
affiché`. Invariants Bella : (1) « nouveaux » Synthèse/Historique = les 12 de l'Aperçu ; (2) 3 réouverts
= électrique/cuisson/nettoyage partout où la vue montre les réouvertures ; (3) aucun aggravé/réouvert
fusionné ; (4) séparation des flux = non mentionné, état précédent conservé ; (5) aucune exclusion liée
à `knowledge_fact`.

**HARD STOP — décision attendue sur Évolution (a) migration confirmée + Tension (b) T1 vs T2 avant tout code.**
