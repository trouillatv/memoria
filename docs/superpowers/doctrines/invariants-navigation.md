# Invariants de navigation

> Établis par Vincent le 2026-07-20, à l'issue de Lot 1 → PR1 → PR2 → lot « Réactivité perçue ».

Ces trois propriétés ne sont **pas** des objectifs de lot : ce sont des **invariants**.
Un objectif se termine ; un invariant se maintient. Toute PR future — navigateur
d'objets, IA, collaboration, peu importe le sujet — s'évalue avec une seule
question :

> **Est-ce qu'elle préserve les trois continuités ?**

---

## Les trois invariants

### 1. Continuité SPATIALE — la structure ne disparaît pas
> **Un changement d'objet ne remonte jamais la coquille.**

Le panneau n'est pas une boîte de dialogue qu'on ouvre et qu'on ferme : c'est le
**lieu où l'on se déplace dans la mémoire**. Passer d'une Action à une Décision,
d'une Décision à un Intervenant, ne doit produire **aucun démontage** du Sheet.

Concrètement interdit : deux animations (sortie + entrée), un voile qui clignote,
un saut de largeur ou de position, un focus qui retombe sur la page.

### 2. Continuité PERCEPTIVE — le contenu change sans rupture
> **Un changement d'objet ne produit pas de rupture visuelle.**

Le critère n'est pas « l'animation est réussie » mais **« l'utilisateur oublie
qu'une transition a eu lieu »**. Une bonne animation attire l'œil ; une excellente
animation disparaît.

Test de recette : après deux ou trois navigations, *mon regard est-il resté sur le
contenu, ou a-t-il été attiré par le mouvement ?* Et à un néophyte : *« le panneau
s'est fermé puis rouvert, ou son contenu a simplement changé ? »*

### 3. Continuité TEMPORELLE — l'interface n'attend pas inutilement
> **Un changement d'objet ne bloque pas inutilement l'interface.**

Une vue ne paie que **ses** requêtes. Ce qui peut être rendu tout de suite est
rendu tout de suite ; les données arrivent en flux. Ouvrir un objet ne met jamais
la page entière en attente.

---

## Deux règles d'arbitrage, apprises en chemin

**Un mouvement qui n'explique aucun changement supplémentaire est inutile et doit
être supprimé.** C'est le SENS qui décide, pas l'esthétique. Exemple : à
l'ouverture d'une fiche, le panneau qui arrive explique déjà le changement — une
animation interne n'y ajoute rien et entre en concurrence. Elle est donc absente.
Lors d'un changement d'objet, en revanche, le mouvement dit « tu es toujours ici,
mais ce que tu regardes a changé » : là, il a un sens.

**Les repères priment sur les mouvements.** Si un mouvement sert un repère, on le
garde ; s'il attire seulement l'œil, on le retire. C'est pourquoi le **fil n'est
jamais animé** : il est l'ancre qui dit « tu es toujours dans le même parcours ».

---

## Hiérarchie de correction

L'ordre compte, et il n'est pas négociable :

1. **Une rupture spatiale se corrige à la cause, jamais par une animation.**
   Si le panneau remonte, on change l'architecture (sortir la coquille de la
   frontière qui la fait disparaître, ne suspendre que ses données). On ne
   cherche **jamais** à masquer un remontage par un effet visuel.
2. **Une rupture perceptive se corrige en simplifiant**, jamais en embellissant :
   retirer le déplacement, puis raccourcir, puis ne garder que le strict minimum.
3. **Une rupture temporelle se corrige en chargeant moins**, avant d'envisager
   d'afficher un substitut. On n'introduit un squelette *que si* la recette
   démontre un temps mort réel — un panneau vide qui arrive plus vite peut être
   objectivement plus rapide et **subjectivement moins stable**.

## Comment ces invariants ont été obtenus

| Invariant | Lot | Acquis |
|---|---|---|
| Spatiale | **PR1 — Coquille persistante** | une seule coquille montée ; le contenu swappe, le Sheet ne se démonte plus |
| Perceptive | **PR2 — Transformation du contenu** | titre et chapô en crossfade, corps qui glisse de quelques pixels ; rien à l'ouverture |
| Temporelle | **Réactivité perçue** | plus de chargement global (13 requêtes → ciblées) ; en-tête et onglets rendus avant les données |

## Limite connue, assumée

Suivre une relation depuis une fiche ouverte sur une **autre surface** que le
chantier (ex. `/actions`) peut encore basculer vers la page du chantier : les
liens de relation pointent en dur vers `/sites/<id>?…`. C'est le futur
**Lot 3 — Navigation contextuelle entre objets**, qui rendra la coquille
transversale (Recherche, Actions, Chantier, Réunion, Mémoire). Cette limite est
parquée, pas oubliée.
