# P-UI-R2e — Audit READ-ONLY : same_object_hypothesis confond « même objet physique » et « même sujet longitudinal »

Date : 2026-08-27. Déclenché par la contestation (Vincent) de l'unique suggestion persistable du
dry-run R2c : `Largeur de passage des dégagements réduite (par frigos) ↔ Dégagement extérieur du
Mall` → `related SOH=true 65 %`. **Aucun code, aucune écriture.** Verdict : la contestation est
fondée ; le contrat `same_object_hypothesis` est défectueux et doit être corrigé **avant** tout
branchement effectif de R2d.

## 1. Preuves complètes (canonical_subject + occurrences + propositions PV)

### Sujet A — « Dégagement extérieur du Mall » (`943a5a7f…`) — business_subject, actif
Occurrences (2) + propositions brutes :
- **2024-07-19** (décision, p.4) : « il a été validé début 2023 avec la DSCGR que l'issue donnant
  sur le mall est suffisante pour évacuer le public, tandis que cette issue est réservée au
  personnel. »
- **2024** (knowledge_fact, p.4) : « Suite aux remarques 2022 au sujet du dégagement donnant sur
  l'extérieur du Mall (**encombré par des armoires froid**) ».
- **2025-08-05** (knowledge_fact, p.1) : « cette Issue de Secours était comptée dans les
  dégagements du food court mais non nécessaire => généralement utilisée par le personnel. »
- **Origine** : PV 2024 + PV 2025. A a déjà **absorbé** « Issue de Secours du food court » (fusion
  humaine P2-C2c de Vincent).
- **Histoire portée** : un **fil réglementaire pluriannuel sur une issue nommée** —
  remarques 2022 (encombrement) → validation DSCGR 2023 (issue suffisante, réservée personnel) →
  confirmations 2024/2025. Famille dominante = **décision / statut réglementaire**.

### Sujet B — « Largeur de passage des dégagements réduite (par frigos) » (`8815498b…`) — business_subject, actif
- **0 occurrence** matérialisée. **1 seule proposition** (famille **observation**, p.1) :
  « **Dégagements OK.** Même si largeur de passage réduite par les frigos (voir photo). »
- **Origine** : un unique PV, une unique observation.
- **Histoire portée** : **aucune**. Constat ponctuel de largeur/obstruction, générique (« les
  dégagements », pluriel, non nommés), **conclu OK** (conforme malgré la réduction).

## 2. Recouvrement physique vs identité de sujet

Un **écho physique plausible** existe (A : « dégagement encombré par armoires froid » 2022 ; B :
« largeur réduite par les frigos »). Mais **B ne nomme pas l'issue du Mall** : « les dégagements »
est générique. Même *si* c'est le même endroit, ce n'est pas le même **objet métier suivi**.

## 3. Ce que produirait une fusion — et la perte sémantique

Fusionner donnerait **une seule ligne de vie** mêlant une **décision de validation réglementaire
DSCGR** (A) et une **observation générique de largeur** (B). Pertes :
1. **B perd sa préoccupation propre** (obstruction/largeur par frigos) : un futur « largeur toujours
   réduite » / « frigos déplacés » n'aurait plus de fil dédié — noyé sous un fil de décision.
2. **A hérite d'un faux problème** : A dit l'issue **validée et suffisante** ; la fusion suggère un
   **problème de largeur ouvert** qu'A n'a jamais porté → **contamination**.
3. **Collision de familles/statuts épistémiques** : décision (validée) + observation (OK) écrasées
   dans une seule identité.
4. On **perd la capacité de dire deux choses vraies et distinctes** : « l'issue est réglementairement
   validée » (A) *et* « une largeur réduite par frigos a été constatée mais OK » (B).

## 4. Classification humaine

**SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN** (au plus **RELATED** ; défendable en **DISTINCT** car
« les dégagements » de B est générique). **JAMAIS SAME_CANONICAL_SUBJECT.**

## 5. Pourquoi SOH a retourné true

Définition actuelle du champ (prompt) : *« ces deux sujets pourraient-ils désigner le MÊME objet
métier durable (même équipement, **même lieu**, même opération) ? »*. La clause **« même lieu »**
laisse la **co-localisation spatiale** (dégagements + frigos, près du Mall) déclencher `true`.
Symptôme flagrant : la **raison rendue par le juge lui-même** décrit deux choses **différentes** —
« *le sujet A décrit un problème spécifique (largeur réduite) affectant un dégagement, tandis que le
sujet B est un dégagement spécifique* » — **et retourne quand même true**. Il a assimilé
*même endroit* à *même sujet*.

Facteur architectural aggravant : **B n'a aucun contexte d'occurrence** (0 occurrence). Le juge a
donc tranché sur les libellés + le contexte riche d'A ; l'écho « dégagement…frigos » a dominé.

## 6. Le prompt confond-il « même objet physique » et « même sujet métier longitudinal » ? — OUI

« même lieu » n'est **pas** une condition suffisante d'identité de sujet. **Un même lieu/équipement
héberge plusieurs fils longitudinaux distincts** (une porte CF : son degré coupe-feu, son
encombrement, sa signalétique, sa maintenance = quatre sujets au même objet). Le contrat actuel
assimile **co-localisation** et **identité de sujet** — c'est le défaut de fond.

## 7. Requalification des positifs du corpus, critère « une seule ligne de vie ? »

Le test committé (`same-object-hypothesis.test.ts`) ne vérifie **que le texte du prompt**, pas des
sorties de juge : les « positifs » sont les témoins empiriques R2/R2c. Requalifiés avec
**« Après fusion, voulons-nous réellement une seule ligne de vie ? »** (et non « peuvent-ils parler
du même endroit ? ») :

| Témoin | Ancien | « Une seule ligne de vie ? » | Nouveau verdict |
|---|---|---|---|
| Issue food court ↔ Dégagement Mall | SOH=true | Oui — **fusion humaine déjà faite** par Vincent (P2-C2c), même issue réglementaire | **SAME_CANONICAL_SUBJECT — survit** ✓ |
| **local technique ↔ local électrique** | SOH=true | Douteux — conformité électrique vs accès/maintenance générique = préoccupations distinctes ; « local technique » générique | **SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN — invalidé** |
| Largeur réduite (frigos) ↔ Dégagement Mall | SOH=true | **Non** — décision réglementaire vs observation ponctuelle OK | **SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN — invalidé** |

**La distinction invalide 2 des 3 positifs.** → **correction du contrat requise avant R2d.**

## 8. Correction du contrat proposée (P-UI-R2e, à valider — non implémentée)

1. **Redéfinir la question SOH** sur le test de la ligne de vie : `true` **uniquement si la fusion
   produit UNE trajectoire chronologique cohérente** (les événements des deux sujets forment une
   seule histoire qu'on voudrait lire entrelacée). **Supprimer « même lieu / même endroit »** comme
   signal suffisant.
2. **Exclusion explicite** : préoccupations distinctes, familles distinctes (décision vs
   observation), trajectoires distinctes **sur le même lieu/équipement → false**.
3. **Contre-exemples à ajouter** :
   - « Dégagement Mall (validation DSCGR) » vs « Largeur réduite par frigos (observation OK) » →
     **false** (même lieu, préoccupations distinctes : statut réglementaire vs obstruction ponctuelle).
   - « Local électrique (conformité) » vs « Local technique (accès générique) » → **false** sauf item
     suivi identique avéré.
4. **Garde d'asymétrie** : quand un côté est une **observation isolée sans histoire** (0 occurrence,
   famille observation), être **encore plus conservateur** — un constat ponctuel est plus
   probablement une *occurrence/preuve* d'un sujet qu'un *sujet durable* (rejoint **P3-B1**).
5. **Mettre à jour les tests de contenu du prompt** (nouvelles chaînes : « une seule ligne de vie »,
   « même lieu ne suffit pas », nouveaux contre-exemples) puis **re-sonder** le corpus.

## 9. Impact sur R2d

- **Pas besoin de revert** : le code R2d est correct et actuellement **inerte** (quota Gemini épuisé,
  aucune suggestion produite). Mais **ne pas s'appuyer** sur la voie sémantique tant que le contrat
  SOH n'est pas corrigé, sinon elle proposera des fusions de type « même endroit, préoccupations
  distinctes ».
- **Séquence recommandée** : P-UI-R2e (corriger le contrat SOH + tests + re-sonde) → puis seulement
  considérer la boucle de rapprochement close → puis P3-B1.

---

# Correction appliquée (P-UI-R2e) — contrat réécrit

GO Vincent : le concept n'est plus « même objet » mais **« même sujet canonique / même préoccupation
longitudinale »**. Nom technique du champ conservé (`same_object_hypothesis`, colonne mig 357 — pas de
migration), langage doc/prompt basculé.

## Ce qui change (code + tests, aucune donnée Bella touchée)

- **`BASE_SYSTEM_PROMPT`** (`lib/subjects/similarity-analyze.ts`) — section SOH réécrite :
  - **Définition normative** : `true` seulement si les deux devraient partager UNE identité métier
    durable et UNE seule ligne de vie chronologique, sans perte ni contamination. Question =
    « si on fusionne, les événements forment-ils l'histoire d'un seul sujet ? » (pas « même objet/lieu ? »).
  - **Conditions insuffisantes à elles seules** : même lieu / équipement / entreprise / domaine
    réglementaire / système technique ; objet↔anomalie / document / contrôle / réserve / action.
  - **Test de fusion** (4 questions) ; toute distinction métier utile perdue → `false`.
  - **« même ligne de vie » ≠ « mêmes états »** : les évolutions d'état du même sujet (à faire→réalisé,
    non conforme→corrigé→conforme) restent le MÊME sujet ; seules les préoccupations distinctes se séparent.
  - **Contre-exemples false obligatoires** : Largeur/Dégagement Mall, Local technique/électrique,
    Registre/Contrôle, Rapport SSI/Contrôle SSI, Réserve porte CF/Porte CF ; témoin `true` food court↔Mall
    sous condition de contexte.
  - **Observation isolée** = signal de prudence, PAS exclusion déterministe (rejoint P3-B1).
- **JSDoc du champ + commentaire de parsing** : concept « même sujet canonique / préoccupation longitudinale ».
- **Tests de contenu du prompt** (`same-object-hypothesis.test.ts`) : 10 assertions du nouveau contrat.

Vérifs : **42 tests PASS** (contrat + gate + feed) ; typecheck 0 ; lint 0.

## Re-sonde empirique — BLOQUÉE (quota Gemini)

`scripts/reprobe-same-subject.ts` (12 cas : 6 témoins + objet↔anomalie/document/contrôle + 3 évolutions).
Exécution : **429 RESOURCE_EXHAUSTED — crédits Gemini épuisés**. Le harnais tourne, isole les erreurs et
produit le tableau, mais la colonne « SOH après » ne peut être remplie tant que les crédits ne sont pas
rechargés.

| # | A | B | SOH avant | SOH après | identité attendue (humain) |
|---|---|---|---|---|---|
| 1 | Issue food court | Dégagement Mall | true | ⏳ | **true** (même issue suivie) |
| 2 | Largeur réduite (frigos) | Dégagement Mall | true | ⏳ | **false** |
| 3 | Local technique | Local électrique | true | ⏳ | **false** |
| 4 | Registre install. élec. | Contrôle install. élec. | false | ⏳ | false |
| 5 | Rapport SSI | Contrôle SSI | false | ⏳ | false |
| 6 | Réserve porte CF | Contrôle porte CF | false | ⏳ | false |
| 7 | Extincteurs (parc) | Extincteur manquant (anomalie) | n/a | ⏳ | false |
| 8 | Installations élec. | Rapport de contrôle (document) | n/a | ⏳ | false |
| 9 | Éclairage sécurité | Contrôle éclairage (contrôle) | n/a | ⏳ | false |
| 10 | Nivellement hors tolérance | Nivellement conforme (VISA) | n/a | ⏳ | **true** (évolution) |
| 11 | Extincteurs à contrôler | Extincteurs contrôlés | n/a | ⏳ | **true** (évolution) |
| 12 | Registre non renseigné | Registre mis à jour | n/a | ⏳ | **true** (évolution) |

## Statut de validation (§8)

- **CODÉ / COMPILÉ / TESTÉ (unitaire)** : contrat réécrit, 42 tests verts.
- **NON VALIDÉ EMPIRIQUEMENT** : la re-sonde LLM (critère §8 : Mall↔food court identité, Largeur/​local
  tech/​Registre pas de fusion, évolutions reconnues) est **bloquée sur la facturation Gemini**. À rejouer
  dès crédits rechargés — `npx tsx --env-file=.env.local scripts/reprobe-same-subject.ts`.
- **Aucune donnée Bella modifiée.** R2e corrige le workflow futur (B), pas le corpus.

**HARD STOP.** Code + tests livrés ; re-sonde empirique en attente du quota Gemini. Ne pas reprendre P3-B1
avant validation empirique du nouveau contrat.
