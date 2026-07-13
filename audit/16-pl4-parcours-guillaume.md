# 16 — PL4 : le parcours de Guillaume (audit MÉTIER, pas technique)

> Demandé le 2026-07-13 : « Stop sur l'infrastructure. Le prochain audit doit
> être centré sur l'expérience de Guillaume. Combien de clics ? Quels objets ?
> Où abandonne-t-il ? Qu'est-ce qui empêche de reproduire la feuille Servinor ? »
>
> **Aucune ligne de code. Tout est vérifié écran par écran.**
>
> La question n'est plus « comment matérialiser une occurrence ». Elle est :
> **« comment Guillaume reconstruit sa feuille en moins de deux minutes ? »**

## 1. Sa feuille — ce qu'elle dit vraiment

```
             1  2  3  4  5  6  7  8  9 10 11 12 13 14 ...
Marie-Thérèse T  T  R  R  T  T  T  R  R  T  T  T  R  R
Giselle       T  R  R  T  T  T  R  R  T  T  T  R  R  T
Estelle       R  T  T  T  R  R  T  T  T  R  R  T  T  T
```

Trois faits que la feuille impose, et qu'on ne peut pas contourner :

1. **Les lignes sont des PERSONNES.** Pas des missions, pas des tâches.
2. **Les cases disent une PRÉSENCE** (Travail / Repos). Pas « quoi faire ».
3. **La rotation se répète.** Ce n'est pas « tous les lundis » : c'est un cycle.

Ce que Guillaume lit sur cette feuille, en trois secondes : **« ce jour-là,
combien de mes filles sont là, et lesquelles ? »** Le ménage, lui, est
sous-entendu — c'est toujours le même.

**MemorIA raisonne exactement à l'envers** : une mission (le *quoi*) qui revient,
et une équipe qui *hérite* de la mission. La personne n'existe nulle part dans le
planning — et c'est **doctrinal** (le planning par personne est une ligne rouge :
`audit/10-planning-pl0.md`).

> **La sortie validée reste l'équipe d'une personne** : « Équipe Marie-Thérèse ».
> L'écran peut afficher le nom du membre actif ; les écritures restent sur
> `team_id`. Une matrice « équipes-mono × jours » **est** sa feuille.

## 2. Le parcours actuel — compté, clic par clic

**Pour créer UN seul rythme** (« Entretien, tous les lundis, 06h-09h ») :

| # | Où | Ce qu'il doit faire | Objet créé |
|---|---|---|---|
| 1 | `/sites` → *Nouveau chantier* | nom + **client** (obligatoire) | **Chantier** |
| 2 | *(quelque part)* | créer un **contrat** | **Contrat** ⚠️ |
| 3 | `/missions` → *Nouvelle mission* | chantier + nom + cadence | **Mission** |
| 4 | `/contracts` → le contrat → *Missions* → la mission → **Modifier** | 4 navigations | — |
| 5 | *+ Ajouter une récurrence* → modal | fréquence + heure début + heure fin + date de début | **Récurrence** |

**Bilan : 4 objets, 3 écrans, ~12 clics** — pour **une** ligne.

### ⚠️ Le contrat est un prérequis DE FAIT

L'écran de récurrence n'existe qu'à l'URL
`/contracts/[id]/missions/[missionId]/edit`, et **le seul lien qui y mène** part
de la liste des missions **d'un contrat** (`contracts/[id]/missions/page.tsx:103`).

**Une mission sans contrat n'a aucun accès à la récurrence.** Le lien de
`/missions` pointe alors vers `/sites/{id}` — un cul-de-sac. Le schéma n'exige
pas le contrat ; **l'interface, si.**

### Et pour SA feuille ?

Sa semaine type, c'est **3 personnes × ~4 jours travaillés × un cycle de
2 semaines**. Traduit dans le modèle actuel : **une récurrence par (personne,
jour)** — soit **une bonne vingtaine**, chacune coûtant les étapes 4 et 5.

**≈ 20 récurrences × ~8 clics = plus de 150 clics.** Et le résultat serait
**FAUX** : sans cycle, chaque récurrence tombe **toutes les semaines**. Sa
rotation A/B disparaît.

> **Verdict : sa feuille n'est pas « difficile » à saisir. Elle est
> IRREPRODUCTIBLE.** Aucun enchaînement de clics ne donne le bon résultat.

## 3. Où il abandonne — les cinq décrochages

1. **Au contrat.** Il vient créer un planning ; on lui demande un objet
   administratif dont il n'a pas parlé. *« Pourquoi un contrat ? »*
2. **À la navigation.** La récurrence est enfouie à **quatre niveaux** :
   Contrats → un contrat → Missions → une mission → **Modifier**. Personne ne
   trouve « Modifier » quand on cherche « planning ».
3. **Au mot « récurrence ».** Il dit *« ma semaine »*, *« mon roulement »*.
   Le produit dit *« ajouter une récurrence à une mission »*.
4. **À la 3ᵉ répétition.** Après avoir saisi lundi, mardi, mercredi… il comprend
   qu'il en a **vingt** à faire — et qu'il n'y a **aucune** façon de dire
   « une semaine sur deux ».
5. **À la relecture.** Même s'il allait au bout : les interventions générées
   naissent **« Non-affectées »** (§5). **Son planning ne dirait pas QUI y va.**
   C'est-à-dire : il ne servirait à rien.

> Cela **n'explique pas** à coup sûr le « 0 rythme actif » — je n'ai pas observé
> Guillaume. Mais chacun de ces cinq points suffirait, à lui seul.

## 4. Les trois verrous — vérifiés dans le code

| Ce qu'il veut dire | Le modèle sait-il ? |
|---|---|
| « lundi **et** vendredi » | **Non** — `day_of_week` est **scalaire** (mig 021:32) → deux récurrences |
| « une semaine sur deux » | **Non** — aucun `cycle_length_weeks`, `anchor_date`, `week_index` |
| « **jusqu'en décembre** » | **Non depuis l'écran** — `ends_on` existe en base (021:35), est **lu partout**… et **n'est écrit nulle part** : absent du modal **et** du schéma de l'action. **~10 lignes de code manquantes.** |
| « équipe A lundi, équipe B mardi » | **Non** — `assigned_team_id` est sur la **mission**, jamais sur la récurrence |
| « Repos » | **Sans objet** — le modèle n'exprime que du positif ; un repos, c'est l'absence d'occurrence. Ce n'est pas bloquant, mais **la grille de saisie devra le traduire** |

## 5. 🔴 Le verrou qui rend tout le reste inutile

**`missions.assigned_team_id` n'est écrit par AUCUN écran.**

Le champ n'est pas dans le type de patch de `updateMission`
(`lib/db/missions.ts:90-97`) ; aucune server action ne le pose ; **seuls les
scripts de seed** le font — en le disant.

**Donc : même si Guillaume réussissait à créer sa semaine type, toutes les
interventions naîtraient « Non-affectées ».** Son planning ne dirait **pas qui y
va** — la seule chose qu'il lit sur sa feuille.

**C'est le prérequis n°1. Avant les cycles.** Un planning qui ne dit pas qui
travaille n'est pas un planning.

## 6. Les deux approches — comparées honnêtement

### Approche 1 — étendre `intervention_templates`

On ajoute trois colonnes optionnelles (`cycle_length_weeks`, `anchor_date`,
`week_index`) et une ligne dans `matchesFrequency`, **avant** le `switch`.

| Critère | Verdict |
|---|---|
| **Impact modèle** | Minimal. Colonnes additives, index unique intact, `occurrenceKey` intact. |
| **Réutilisation** | **100 %** — moteur, génération, idempotence, RLS, PL3 : rien ne bouge. |
| **Simplicité pour Guillaume** | ❌ **Aucune amélioration.** Sa semaine type reste **20 objets sans nom**, saisis un par un. Il gagne la justesse (le cycle tombe juste), il ne gagne **aucun clic**. |
| **Évolutivité** | Moyenne. Une « semaine type » sans objet parent ne peut être ni **nommée**, ni **dupliquée**, ni **décalée**, ni **supprimée d'un geste**. Chaque évolution (vacances, remplacement) devra boucler sur N lignes anonymes. |

**En un mot : ça corrige le moteur, ça ne corrige pas le produit.**

### Approche 2 — un objet métier « Semaine type » (Cycle)

Le cycle devient **un objet du chantier**, au même titre qu'une visite ou une
action. Guillaume le nomme, le remplit dans une grille, le répète jusqu'à une
date. Les récurrences deviennent une **projection interne** du cycle — et
cessent d'être ce que l'utilisateur manipule.

| Critère | Verdict |
|---|---|
| **Impact modèle** | Un vrai objet (table `planning_cycles` + ses créneaux), plus un rattachement sur les templates. Plus lourd — mais **c'est un objet métier, pas un écran**. |
| **Réutilisation** | **Élevée** si le cycle **dérive** des templates : le moteur, l'index, l'idempotence, la génération et PL3 restent **intacts**. ⚠️ **Piège** : deux sources de vérité si l'on peut éditer un template **et** son cycle. **Règle** : un template né d'un cycle n'est **jamais** éditable à la main — le cycle est la seule vérité, on **régénère**. |
| **Simplicité pour Guillaume** | ✅ **C'est le point.** Une grille agents × jours, Travail/Repos, **une seule fois**. « Répéter jusqu'au 31/12 ». Un objet, un nom, un geste. **Sa feuille, à l'écran.** |
| **Évolutivité** | ✅ La bonne fondation. Un jour férié, une fermeture, un remplacement deviennent des **exceptions datées SUR le cycle** — et non 20 corrections dispersées. C'est aussi ce qu'exige PL5, PL6 (vue mois) et PL7. |

## 7. Recommandation

**L'approche 2 — et la doctrine que tu viens de graver le dit avant moi :**

> *« Toute fonctionnalité doit d'abord être rattachée à un objet métier existant,
> ou justifier la création d'un nouvel objet. On ne construit plus des écrans, on
> construit des objets métier que les écrans projettent. »*

**L'objet mental de Guillaume, c'est LA SEMAINE TYPE.** Ce n'est pas « vingt
récurrences ». Si l'objet du produit ne coïncide pas avec l'objet de sa tête, il
n'y aura jamais d'assistant assez malin pour rattraper l'écart.

L'approche 1 est **une optimisation du moteur qui laisse le produit intact** :
elle rendrait ses rythmes justes, sans les rendre **créables**. Or son problème
n'est pas la justesse — **c'est qu'il abandonne avant**.

### Ce que je propose comme ordre

| Lot | Contenu | Pourquoi d'abord |
|---|---|---|
| **PL4-0** | **Une mission sait quelle équipe la porte** : exposer `assigned_team_id` dans `updateMission` + un sélecteur sur la mission | **Sans lui, tout planning est « Non-affecté ».** Petit, immédiat, et il corrige un bug **actif aujourd'hui**, indépendamment des cycles |
| **PL4** | L'objet **Semaine type** (cycle) : le modèle, dérivant les templates. Un cycle = un nom, une durée (1 à 4 semaines), une date d'ancrage, une date de fin, et ses créneaux (équipe × jour × heures) | C'est l'objet métier |
| **PL5** | La **grille de saisie** : agents (équipes-mono) en lignes, jours en colonnes, Travail/Repos au clic. « Répéter jusqu'au… ». Aperçu du mois avant publication | C'est là que les 150 clics deviennent 2 minutes |

**Et une règle que je propose de graver** : `ends_on` doit être saisissable **dès
PL4**. Un rythme sans fin, c'est un rythme qu'on n'ose pas créer.

## 8. Ce que je ne sais pas — et que je ne peux pas inventer

Je n'ai **pas observé** Guillaume. Les cinq décrochages du §3 sont des
**hypothèses déduites du code**, pas des faits d'usage. La seule certitude, c'est
que **sa feuille est irreproductible aujourd'hui** — ça, c'est démontré.

Ce qui trancherait vraiment : **le regarder essayer**, dix minutes, sans l'aider.
On saurait alors où il s'arrête réellement — et si c'est bien au contrat, à la
navigation, ou au mot « récurrence ».

**Aucune ligne de code n'a été écrite. Ce document attend ton arbitrage.**
