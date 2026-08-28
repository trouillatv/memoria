# #228 Lot B — Audit READ-ONLY de l'éligibilité à la stagnation

**Statut : AUDIT + SIMULATION READ-ONLY. Aucun code, aucun seuil, aucune migration, aucun changement d'Attention.**
HARD STOP. Lot A validé et figé (durableKind/dominantFamily inchangés). Voir [[kind-dominance-audit]].

## 1. Root cause historique de STAGNATION_INELIGIBLE

`STAGNATION_INELIGIBLE = {person, company, knowledge_fact, deadline}` (canonical-subject-life.ts:1096).
Deux usages :
- fiche `getCanonicalSubjectLife` L814 : `!STAGNATION_INELIGIBLE.has(primaryFamily)` (primaryFamily = famille de
  la 1re occurrence, L781) ;
- grille `getNavigableSubjectsForSite` L1522 : `!STAGNATION_INELIGIBLE.has(dominantFamily)`.

Condition complète : `isStagnant = éligible && !closed && stagnationDays>=30 && consecutiveMentions>=2`.

Consommateurs de `isStagnant` : `computeAttentionSignals` (raison `stagnant`), `navSortPriority` (bucket « à
surveiller »), `deriveSiteAttentionItems` (signal `subject_stagnant`), fiche sujet, SujetsList, copilot-context.

**Héritage faux depuis Lot A** : exclure par la FAMILLE `knowledge_fact` supposait « knowledge_fact = sujet
informatif ». Faux : un business_subject peut avoir une 1re occurrence knowledge_fact et rester opérationnel.
Mais « business_subject ⇒ peut stagner » (S1) est un remède pire que le mal.

## 2. Simulation (scripts/p228b-stagnation-sim.ts) — seuils INCHANGÉS, seul le prédicat d'éligibilité varie

- **S0** actuel : `!STAGNATION_INELIGIBLE.has(dominantFamily)` (family-based).
- **S1** borne haute : `durableKind=business_subject` (tout business).
- **S2** trajectoire ouverte : business `&& currentTriState='open'`.
- **S3** attente prouvée : business `&& (objet opérationnel ouvert OU reopened)`.

### Corpus (Bella / OCEF / PETRO)

| Chantier | S0 | S1 | S2 | S3 |
|---|---|---|---|---|
| BELLA NAPOLI | 0 | 0 | 0 | 0 |
| Lycée PETRO ATTITI | 0 | 0 | 0 | 0 |
| OCEF Recette B | 0 | 0 | 0 | 0 |
| OCEF Compostage (2c) | 2 | 20 | 2 | 0 |
| OCEF Compostage (06) | 4 | 9 | 2 | 3 |
| Ocef4 | 0 | 0 | 0 | 0 |
| **Total** | **6** | **29** | **4** | **3** |

**Nouveaux vs S0** : S1 **+23** · S2 **+1** · S3 **+1**. **Acteurs stagnants : 0** (tous scénarios).

Décomposition des +23 de **S1** (borne haute) : **21 knowledge purs sans objet** (flood), **18 resolved**
(faux positifs : sujets déjà résolus), 4 unknown, 1 doublon Attention. → **S1 REJETÉ** (exactement le risque
anticipé).

### Cas négatifs (garde anti-flood) — PROUVÉS

12 business_subject `resolved`, anciens (91–154 j), 0 objet, non reopened — ex. « Débroussaillage » (154 j),
« Démarrage des travaux » (154 j), « Marché signé par le maître d'ouvrage » (119 j) : deviendraient stagnants
**sous S1** (faux problèmes), **jamais sous S2/S3**. C'est le garde-fou principal : un fait résolu et clos ne
doit pas devenir un problème artificiel après 300 j.

### Bella témoins

**Aucun témoin Bella n'atteint le seuil temporel** (`tempOK=non` partout) : la plupart ont `stagnationDays=0`
(matérialisés récemment) ; `éclairage` 387 j et `Mall` 382 j mais `consecutiveMentions=1 < 2`. Donc sur Bella,
**aucun sujet n'est stagnant sous AUCUN scénario aujourd'hui** — l'éligibilité y est théorique. La stagnation
est en pratique une question OCEF Compostage (plus de PV, vrais intervalles). Réponse à « si cuisson ne change
plus 60 j, est-ce stagnant ? » : cuisson = open sans objet → **oui sous S2, non sous S3**. C'est le cœur du choix.

## 3. Trois notions distinctes (rappel)

- **navigable** : vrai sujet métier — OK.
- **opérationnel** : peut participer aux calculs métier — corrigé Lot A (durableKind).
- **stagnant** : une évolution était ATTENDUE et n'est pas venue — objet du Lot B. `business_subject` dit « sujet
  métier », PAS « doit évoluer ». La stagnation ne doit dépendre ni de la nature ni de la famille, mais du fait
  que **la trajectoire actuelle implique encore quelque chose à résoudre/surveiller/attendre**.

## 4. Règle minimale recommandée

**S3 — attente d'évolution prouvée** : `business_subject && (objet opérationnel ouvert OU reopened)`, seuils
inchangés (30 j / 2 mentions / !closed). Justification :
- +1 seulement vs S0 (aucun flood) ; **0 knowledge pur, 0 resolved faux positif, 0 acteur** ;
- aligne la stagnation sur un signal CONCRET d'évolution attendue (action/réserve/deadline ouverte, ou réouverture) ;
- reopened déjà intégré comme candidat fort (mais **aucune nouvelle règle d'Attention créée ici**).

**Alternative S2** (business && open) : +1 aussi, mais inclut des sujets « open sans objet » (ex. cuisson) dont
l'attente d'évolution n'est pas matérialisée → plus proche du bruit. À trancher par Vincent.

**Nuance à valider (non purement additif)** : S0=6 mais S2=4 / S3=3. S2/S3 RETIRENT aussi des stagnants S0
(sujets observation en état `unknown`, sans objet ni trajectoire ouverte). À confirmer que ces retraits sont
légitimes (un observation `unknown` ancien sans rien de pendant n'est pas « stagnant » mais simplement « ancien »).

## 5. Impact attendu AVANT/APRÈS (si S3 retenu, code = lot ultérieur)

- Stagnants corpus : 6 → 3 (−3 observation-unknown retirés, +1 attente-prouvée ajouté sur OCEF 06).
- Aucun knowledge pur, aucun resolved, aucun acteur.
- Attention `subject_stagnant` : quasi inchangée (les gates aval décident).

## 6. Tests nécessaires (pour le futur lot de code)

- S3 éligible : business + action ouverte → stagnant si temporel OK ; business + reopened → idem.
- S3 non éligible : business resolved sans objet (« Démarrage des travaux ») → jamais stagnant, même 300 j.
- knowledge pur business sans objet → jamais stagnant.
- actor → jamais stagnant (assertion 0).
- retraits S0→S3 : observation unknown sans objet → non stagnant (documenter le changement).

## 7. HARD STOP

Aucun code, aucun seuil, aucune migration, aucun changement d'Attention. Décision de la règle (S2 vs S3, et
validation des retraits S0) = Vincent. Puis, éventuellement, lot de code dédié, puis #218.
