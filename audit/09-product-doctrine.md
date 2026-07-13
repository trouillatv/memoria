# 09 — Doctrine produit

> Uniquement les invariants — ce qui ne changera pas. Pas de code, pas de SQL,
> pas de fichiers. Les choix d'implémentation actuels n'y ont pas leur place.
> Toute PR qui viole une de ces règles doit le dire explicitement et attendre
> un arbitrage.

## Vision

MemorIA est la mémoire opérationnelle d'un lieu,
exploitable au bon moment.

Le monde est déjà en place : sites, équipes, planning permanent.
Les événements le perturbent ; l'application ne le reconstruit pas.

Les exceptions valent plus que le planning.

MemorIA transforme un planning existant en mémoire vivante.
Il ne remplace ni Excel ni un logiciel RH.

Le produit évolue à partir de l'usage observé,
jamais à partir d'une hypothèse seule.

## Mémoire

Une preuve n'est jamais détruite par un geste de rangement.

Une visite possède une seule source de vérité.

Le mobile et le desktop présentent la même réalité.
Ils ne créent jamais deux versions d'une même information.

L'artefact brut n'est jamais supprimé ;
l'IA propose, l'humain valide.

## Contexte

L'utilisateur travaille toujours dans un contexte explicite :
site, chantier, réunion, intervention ou visite.

Une information n'est jamais présentée sans son contexte.

Une action n'est jamais montrée hors du chantier qui l'explique.

## Langage

Un objet répond à une seule question :
réunion décide, intervention exécute, visite observe,
mission organise, planning coordonne, action engage.

Un écran a un verbe. Un écran qui en mélange deux est suspect.

L'utilisateur voit un seul verbe de rangement : **Retirer**.
Jamais soft, hard ou skipped.

Un site ne s'affiche jamais sans son client.

Les couleurs représentent des faits,
jamais des suppositions de l'IA.

Jamais de métrique par personne. On organise, on ne mesure pas.

Le vocabulaire est celui du conducteur, jamais celui du développeur.

## Temps

La mémoire raconte ce qui s'est passé ;
elle ne réécrit jamais le passé.

Chaque preuve garde sa date, son auteur et son contexte d'origine.

## Isolation

Une donnée n'existe que dans son organisation.
Pas d'organisation : rien — jamais « tout le monde ».

Deux seules exceptions : le super-admin plateforme
et l'écran d'administration plateforme.

Toute écriture vérifie l'appartenance de l'objet au tenant.

L'organisation d'un objet vient de son parent, jamais de la session.

Un rôle plateforme ne naît jamais dans un tenant.

## Fiabilité

Une mutation rafraîchit toutes les vues concernées.

Aucun prérequis caché : ce qui manque est nommé,
et l'objet manquant se crée sans perdre le geste en cours.

Rien n'est déclaré terminé sans preuve.

## L'objet métier avant l'écran (Vincent, 2026-07-13)

> **Toute nouvelle fonctionnalité doit d'abord être rattachée à un objet métier
> existant, ou justifier la création d'un nouvel objet métier. Aucun écran,
> aucune vue et aucun composant ne peut être créé directement.**

Ce que cette règle renverse : on ne construit plus des écrans, on construit des
**objets métier solides que les écrans se contentent de projeter**. Quand les
objets sont excellents, les vues (Aperçu, Chronologie, Planning, Documents,
Mémoire) deviennent riches **sans effort** — elles ne font que les regarder.

Trois corollaires, à opposer à toute PR :

- **Un lot n'est pas une architecture.** PL4 (les cycles) ne décide pas du
  modèle ; il l'applique.
- **Un audit ne décide pas de l'UX.** Il constate, il ne conçoit pas.
- **Une contrainte technique ne décide pas d'un concept métier.** Si le schéma
  gêne, on discute le schéma — on ne déforme pas le métier pour lui plaire.

La référence d'architecture est `docs/design/architecture-espace-chantier.md` :
le **chantier** est l'agrégat central ; visites, réunions, actions, documents,
équipes et mémoire sont **ses objets** ; les vues ne créent **jamais** d'objet et
ne concurrencent **jamais** une fiche canonique.

**Ordre de travail qui en découle** : rendre excellentes les cinq fiches
canoniques — **Action**, **Visite**, **Réunion**, **Document/Preuve**, puis la
**Recherche transverse** — avant toute nouvelle vue.
