# 17 — PL4-Design : « Construis-moi ton planning de septembre »

> Demandé : deux livrables, **aucun code**.
> 1. La maquette complète du parcours.
> 2. La comparaison argumentée : **un assistant qui génère des templates** (B)
>    contre **un objet `Cycle` persistant** (A).
>
> Correction préalable, méritée : j'avais **postulé** A, je ne l'avais pas
> **prouvé**. Ce document tranche — et la démonstration ne se joue pas là où je
> le croyais.

## Ce que l'audit prouvait vraiment (et que j'avais mal vendu)

J'ai mis en avant « **150 clics** ». C'est une illustration, pas une preuve.
La preuve est plus dure, et il faut la dire ainsi :

> **Même au bout des 150 clics, Guillaume n'aurait PAS son planning.**

S'il fallait 150 clics pour un résultat juste, ce serait un problème d'**UX**.
Ici, **le modèle ne peut pas représenter son roulement**. Ce n'est pas une
friction — c'est une **impossibilité**. C'est beaucoup plus grave, et c'est le
seul argument dont on a besoin.

De même, **PL4-0 n'est pas « un bug à corriger »**. C'est :

> **rendre le planning LISIBLE.** Un planning où tout est « Non affecté » ne dit
> pas qui travaille — donc il ne sert à rien. Le bénéfice est **fonctionnel**.

## Le vocabulaire — il change tout

Guillaume dit : **semaine**, **roulement**, **travail**, **repos**, **équipe**.
Le produit dit : *fréquence*, *récurrence*, *weekly*, *mission*, *template*.

**Aucun mot de la colonne de droite n'apparaîtra dans l'écran.** C'est une
contrainte de conception, pas une préférence.

---

# LIVRABLE 1 — La maquette

## Écran 0 — Le point d'entrée

Depuis la fiche chantier, onglet **Planning** :

```
  Discount — Poindimié                              [ + Créer le planning ]

  Aucun planning régulier.
  Les interventions sont saisies une par une.
```

**Un seul bouton.** Pas de « récurrence », pas de passage par un contrat, pas de
mission à créer d'abord. *(Ce que cela implique du modèle est traité au §
Livrable 2.)*

## Écran 1 — Le roulement, en une grille

```
  Planning régulier — Discount Poindimié

  Nom      [ Roulement magasin                    ]
  Cycle    ( ) 1 semaine   (•) 2 semaines   ( ) 3   ( ) 4

  ─────────────────────────────────────────────────────────
                      L    M    M    J    V    S    D
  SEMAINE A
   Marie-Thérèse      ■    ■    ·    ·    ■    ■    ■
   Giselle            ■    ·    ·    ■    ■    ■    ·
   Estelle            ·    ■    ■    ■    ·    ·    ■

  SEMAINE B
   Marie-Thérèse      ·    ·    ■    ■    ■    ·    ·
   Giselle            ■    ■    ■    ·    ·    ■    ■
   Estelle            ■    ■    ·    ·    ■    ■    ·
  ─────────────────────────────────────────────────────────
   ■ travail    · repos          (cliquer une case = basculer)

  Horaire habituel   [ 06:00 ] → [ 09:00 ]     ⓘ modifiable par case

  [ + Ajouter quelqu'un ]
```

**Ce que la grille impose, et qui est non négociable :**

- **les lignes portent des NOMS** (Marie-Thérèse), pas « Équipe 3 ». En base, ce
  sont des **équipes-mono** — l'écran affiche le membre actif. La ligne rouge du
  planning par personne **n'est pas franchie** (les écritures restent sur
  `team_id`) ;
- on clique **une case**, elle bascule. Comme dans son Excel ;
- **le repos est un état, pas une absence.** Il se voit. C'est ce que sa feuille
  dit en premier — *elle est faite pour lire les repos* ;
- **aucune mission n'est demandée ici.** Le ménage est sous-entendu : il est le
  même tous les jours.

## Écran 2 — Jusqu'à quand

```
  Ce roulement s'applique

  du   [ 01/09/2026 ]        ← la semaine A commence ici
  au   [ 31/12/2026 ]        ( ) sans date de fin

  → 17 semaines · 9 semaines A · 8 semaines B
```

Une seule phrase, deux dates. **`ends_on` devient enfin saisissable** — il existe
en base depuis 2023 et **aucun écran ne l'écrit**.

## Écran 3 — Ce que ça donne (avant de publier)

```
  Septembre 2026                      ⚠ 2 points à regarder

       L   M   M   J   V   S   D
   1   ·   MT  MT  MT  ·   ·   MT        ⚠ jeu. 17 — jour férié
   2   MT  MT  ·   ·   MT  MT  MT           (le site est ouvert : maintenu)
   3   ·   ·   MT  MT  MT  ·   ·
   4   MT  MT  MT  ·   ·   MT  MT        ⚠ lun. 28 — personne le matin
   5   ...

   [ Modifier le roulement ]   [ Enregistrer sans publier ]   [ PUBLIER ]
```

Il **voit son mois** avant de valider. Les deux avertissements réutilisent
**PL2/PL3** (fermetures, conflits) — déjà livrés.

## Écran 4 — LE MOMENT DÉCISIF : il modifie

Trois semaines plus tard, Giselle est en arrêt. Guillaume rouvre.

```
  Roulement magasin — Discount Poindimié

  [ Modifier le roulement ]   ← rouvre la grille des écrans 1-2
  [ Décaler d'une semaine ]   ← A ↔ B
  [ Arrêter au ... ]
  [ Retirer ]

  Exceptions (3)
   • 14 juil.  jour férié — maintenu
   • 12→19 août Giselle absente — remplacée par Estelle
   • 3 sept.   magasin fermé — déplacé au 4
```

**C'est ici que tout se joue.** Pas à la création — **à la deuxième fois.**

---

# LIVRABLE 2 — A contre B, sur la MÊME maquette

Les deux approches donnent **exactement les écrans 0 à 3**. La saisie est
identique, le nombre de clics est identique, le résultat en base est identique
(des `intervention_templates`, projetés par le moteur PL1).

**Elles divergent à l'écran 4.**

## B — L'assistant qui génère des templates

Le formulaire produit N récurrences, puis **disparaît**. Il ne reste que les
templates.

| Question | Réponse |
|---|---|
| **Créer** | ✅ Identique à A. Même grille, mêmes clics. |
| **Rouvrir « Roulement magasin »** | ❌ **Il n'existe pas.** Guillaume retrouve **20 lignes anonymes** : « Tous les lundis 06h-09h », « Tous les mardis 06h-09h »… Son roulement n'est **plus un objet** : il a été *dissous*. |
| **Décaler la rotation d'une semaine** | ❌ **20 modifications**. Rien ne dit lesquelles vont ensemble. |
| **« Ce roulement va jusqu'à quand ? »** | ❌ Il faut lire les 20 `ends_on` et espérer qu'ils coïncident. |
| **Arrêter le roulement** | ❌ Supprimer 20 objets, un par un, sans se tromper. |
| **Accrocher une exception** (férié, remplacement) | ❌ **À quoi ?** Il n'y a rien qui s'appelle « le roulement ». On ne peut l'accrocher qu'à une **occurrence** — donc PL7 devra les traiter une par une, sans jamais pouvoir dire « pendant les vacances, Estelle remplace Giselle ». |
| **Coût** | 🟢 Le plus faible. Aucune table. Réversible. |
| **Risque** | 🔴 **On reconstruit son Excel — puis on le déchire en vingt morceaux devant lui.** |

## A — L'objet `Cycle` persistant

Le roulement **est** un objet du chantier. Les templates en sont la **projection
interne** — Guillaume ne les voit jamais.

| Question | Réponse |
|---|---|
| **Créer** | ✅ Identique à B. |
| **Rouvrir « Roulement magasin »** | ✅ Sa grille revient, telle qu'il l'a laissée. |
| **Décaler d'une semaine** | ✅ **Un champ** : la date d'ancrage. |
| **« Jusqu'à quand ? »** | ✅ Écrit sur l'objet. |
| **Arrêter** | ✅ Un geste. |
| **Accrocher une exception** | ✅ **Elle a un support.** « Du 12 au 19 août, Estelle remplace Giselle » se pose **sur le cycle** — c'est le prérequis de PL7, et de la vue mois. |
| **Coût** | 🟠 Une table + ses créneaux. Et **un piège** (ci-dessous). |
| **Risque** | 🟠 **Deux sources de vérité**, si on peut éditer un template né d'un cycle. |

### Le piège de A, et la règle qui le désarme

> **Un rythme né d'un cycle n'est JAMAIS éditable à la main.** Le cycle est la
> seule vérité. On **régénère** ses templates à chaque modification.
> L'écran de récurrence actuel devient **inaccessible** pour eux.

Sans cette règle, A est **pire** que B : deux endroits qui disent des choses
différentes. Avec elle, A est strictement supérieur.

## La démonstration, en une ligne

**B et A se créent pareil. Ils se VIVENT différemment.**

Le planning de Guillaume n'est pas un artefact qu'on pose une fois : **c'est un
objet vivant**, qu'il décale, corrige, suspend, reprend — c'est exactement ce que
son Excel lui permet, et c'est pour ça qu'il y revient.

> **Un assistant fabrique un planning. Un objet fait vivre un roulement.**

**B optimise la création. A rend le roulement RÉEL.** Et comme la doctrine le
dit : *« on construit des objets métier que les écrans projettent »* — B ne
construit **aucun** objet : il construit un **écran** qui produit des lignes.

## Recommandation : **A**, avec la règle « le cycle est la seule vérité »

Mais **A n'est justifiée que si Guillaume modifie vraiment son roulement.** Si
son planning était figé six mois durant, B suffirait — et coûterait moins.

**Ce que je crois** : son Excel est **raturé en permanence** (arrêts, échanges,
remplacements — le cas Giselle est arrivé pendant votre entretien). Mais c'est
une **conviction, pas une preuve**.

---

# Ce qui trancherait vraiment : dix minutes d'observation

**« Construis-moi ton planning de septembre. »** On filme l'écran. On
n'intervient pas.

Cette maquette repose sur **cinq hypothèses**, et une seule séance les confirme
ou les tue :

| # | Hypothèse de la maquette | Si elle est FAUSSE… |
|---|---|---|
| 1 | Il commence par le **roulement**, pas par une mission | …l'écran 0 est au mauvais endroit |
| 2 | Il dessine **les repos** d'abord | …la grille doit s'ouvrir « tout en travail » |
| 3 | Il pense **par équipe**, pas par chantier | …le point d'entrée n'est pas la fiche chantier, mais **l'équipe** |
| 4 | Il veut voir **un mois** avant de publier | …l'écran 3 est du luxe |
| 5 | Il **modifie** souvent son roulement | …**B suffit, et A est du gaspillage** |

**L'hypothèse 5 est celle qui décide entre A et B.** Elle ne se déduit d'aucun
code — elle s'observe.

Dix minutes de vidéo valent plusieurs semaines de développement. Et si
l'observation me contredit, **c'est elle qui gagne**.

**Aucune ligne de code n'a été écrite.**
