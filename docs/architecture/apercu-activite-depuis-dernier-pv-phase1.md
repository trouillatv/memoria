# #230 Lot B Phase 1 — « Depuis le dernier PV » : audit du contrat (READ-ONLY)

**Statut : Phase 1 READ-ONLY. Aucun code, aucune donnée modifiée.** HARD STOP pour décision produit.
Sonde : `scripts/p230-activite-audit.ts`.

## 1. Contrat actuel & origine de la fusion

`pvLastDelta` (SiteOverviewTab) provient de `fetchPvSignalData` → **`getCanonicalDelta` + `computeDeltaSummary`**
(`site-overview.ts:501-508`). La fusion est ici : `computeDeltaSummary` (`site-synthesis.ts:150-151`) fait
`case 'aggravated': case 'reopened': s.aggravésRéouverts.push(item)` — **il MERGE aggravé et réouvert**,
alors que `getCanonicalDelta` les produit comme deux transitions DISTINCTES. Le libellé « aggravés » du banner
est donc faux quand les cas sont des réouvertures.

## 2. La séparation est récupérable SANS nouvelle sémantique

- **aggravé vs réouvert** : `getPvDelta` (occurrence-first, P0-2c, MÊME source que Chronologie/#229) expose
  `items[].transition` avec `réouvert` ≠ `aggravé`. Mesuré Bella : `getPvDelta` → **réouvert=3, aggravé=0**,
  alors que `pvLastDelta` actuel dit `aggravésRéouverts=3`. Les 3 « aggravés » sont bien **3 réouvertures**. ✅
- **nouveau vs réapparu** : `cellDeltaTransition` collapse `réapparu → nouveau` (site-occurrence-timeline.ts:209).
  Mais la distinction est récupérable depuis l'**axe de présence** (`buildSiteSubjectCells` : un « nouveau »
  ayant une présence réelle à un PV antérieur = réapparu). Mesuré OCEF PV6→PV10 : nouveau=3 brut → **nouveau=1 +
  réapparu=2** après raffinement. ✅ Aucune sémantique inventée.

**→ Pas de HARD STOP sémantique.** Les primitives existantes suffisent.

## 3. Mesures corpus (2 derniers PV)

| Site (delta) | réouvert | aggravé | nouveau | réapparu | résolu | maintenu | non_mentionné | changé | « vrais changements » | maintenu+non_ment. |
|---|---|---|---|---|---|---|---|---|---|---|
| **BELLA** 2024→2025 | **3** | 0 | 19* | 0 | 3 | 5 | 6 | 0 | 25* | 11 |
| **OCEF Compo** PV9→PV10 | 0 | 0 | 7* | 0 | 0 | 62 | 34 | 0 | 7* | **96** |
| **OCEF Compo** PV6→PV10 | 1 | 0 | 1 | 2 | 15 | 22 | 13 | 2 | 21 | 35 |

Rappel : `pvLastDelta` actuel Bella = `{nouveaux:2, aggravésRéouverts:3, réalisésLevés:0}`.

**Deux décisions produit apparaissent (à trancher AVANT code) :**

### Décision 1 — POPULATION (garde-fou bruit)
`getPvDelta` est au niveau de TOUS les canonical_subjects, **acteurs et knowledge_facts inclus**. D'où
Bella « nouveau=19 » : la liste contient des ACTEURS (« David BOUVIER », « SACD (GBH) », voire « BELLA NAPOLI »)
et des knowledge_facts. Le `pvLastDelta` actuel affiche 2 car `getCanonicalDelta` **exclut** les sujets
person/company/knowledge_fact-only (OPERATIONAL_EXCLUDED_FAMILIES). Options :
- **(a)** exclure les acteurs uniquement (durableKind=actor, cohérent #228) → garde les knowledge_facts métier
  qui ont réellement évolué (ex. « Contrôles climatisation réalisé ») ;
- **(b)** exclure acteurs + knowledge_fact (comme le delta actuel) → plus proche des 2 « nouveaux » actuels,
  mais perd des évolutions métier réelles (post-#228, knowledge_fact ≠ non opérationnel) ;
- **(c)** exclure acteurs, et pour knowledge_fact ne garder que ceux portant un objet/une évolution d'état.

Recommandation : **(a)** (exclure les acteurs, garder le métier), aligné sur la doctrine #228. À valider.

### Décision 2 — DENSITÉ (garde-fou flood)
OCEF PV9→PV10 = 62 maintenus + 34 non-mentionnés = **96** : lister toutes les catégories = mur d'informations.
Hiérarchie mesurée (les « vrais changements » sont peu nombreux et à haute valeur) :
1. **réouverts** (rares, forts) — lignes explicites navigables ;
2. **aggravés** — idem ;
3. **nouveaux** (filtrés population) — lignes explicites ;
4. **résolus/levés** — peuvent être volumineux (OCEF PV6→PV10 = 15) → **compteur + top-N** plutôt que N lignes ;
5. **maintenus** / **non-mentionnés** — TRÈS volumineux, faible valeur d'activité → **compteur seul** (pas de
   liste), avec accès « Voir tous les changements → » (Chronologie).

Recommandation densité : afficher explicitement réouverts + aggravés + nouveaux (métier) ; résolus en compteur
+ quelques exemples ; maintenus/non-mentionnés en compteurs seuls. Cap global (~8-10 lignes) avec lien vers la
Chronologie pour l'exhaustivité. À valider.

## 4. Restitution cible proposée (à partir des données réelles Bella)

```
DEPUIS LE DERNIER PV                                    19 juillet → 5 août
↩ 3 réouverts
   ↩ Contrôle des installations électriques   (résolu → à refaire)   →fiche
   ↩ Nettoyage des conduits d'extraction                              →fiche
   ↩ Contrôle des appareils de cuisson                                →fiche
✚ 2 nouveaux (métier)
   ✚ …                                                                →fiche
   ✚ …                                                                →fiche
✓ 3 résolus · = 5 maintenus · ∅ 6 non mentionnés
Voir tous les changements →  (Chronologie)
```
Chaque sujet listé = navigable vers sa fiche. « non mentionné » n'est JAMAIS présenté comme « résolu ».

## 5. Périmètre interdit (rappel)

Ne pas toucher : #229/narrateTrajectory (réutilisation pure OK), sélection/scoring Attention, stagnation,
canonical_subject.kind, objets métier, occurrences, matching, seuils, propositions d'actions, compteurs Lot C
(« 7 proposées → 3 visibles » reste #231).

## 6. Décision attendue (HARD STOP)

1. **Population** : (a) exclure acteurs / (b) exclure acteurs+knowledge_fact / (c) hybride ?
2. **Densité** : valider « réouverts+aggravés+nouveaux explicites ; résolus compteur+exemples ;
   maintenus/non-mentionnés compteurs seuls ; lien Chronologie » ?

Aucun code tant que ces deux points ne sont pas tranchés. Ensuite Phase 2 (implémentation) + Phase 3 (recette).
