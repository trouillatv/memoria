# Un objet n'est jamais remplacé par son conteneur

> Établi par Vincent le 2026-07-20, à la clôture du Lot 3.
> Né d'un arbitrage de navigation, **promu règle de modélisation**.

## La règle

> **Un conteneur est une relation navigable depuis l'objet, jamais une destination
> substituée à lui.**

Formulation côté recherche, qui en est le cas le plus visible :

> **La recherche ouvre l'objet qui satisfait la requête, pas le conteneur qui le
> référence.**

## Ce qu'elle décide, sans discussion

| On cherche | On ouvre | Pas |
|---|---|---|
| une Réunion | la Réunion | le Chantier |
| un Document | le Document | la Réunion |
| une Réserve | la Réserve | le Sujet |
| une Action | l'Action | le Chantier |
| une Décision | la Décision | le Sujet |

**Le conteneur devient un contexte, jamais un écran de substitution.**

## Pourquoi elle tient

Elle n'est devenue vraie qu'une fois les fiches dotées de leur **fil**. Tant que le
contexte n'existait que dans la page conteneur, ouvrir le conteneur était un pis-aller
défendable. Aujourd'hui la fiche porte sa propre position dans l'histoire : substituer
le conteneur, c'est répondre à côté de la question posée.

Elle prolonge la 2ᵉ règle de produit — *un clic = une continuité* — en la rendant
opposable : approfondir ce qu'on regardait, ce n'est pas remonter d'un cran.

## Portée

Elle s'applique à **toute porte d'entrée** (recherche, palette ⌘K, lien de relation,
notification, lien externe) et à **tout type d'objet**, y compris ceux qui n'existent
pas encore. Un nouvel objet n'a pas à rediscuter la sémantique du graphe : il hérite
de cette règle.

Corollaire opérationnel : la règle de destination vit dans **un seul module pur**
(`lib/memory/hit-href.ts`). Une porte l'applique ; elle ne la réécrit pas.

## Limite honnête, au 2026-07-20

Réserve, Document, Réunion et Observation n'ont pas encore leur propre navigation :
leur repli vers le chantier est **assumé et temporaire**, pas une exception à la règle.
Le Lot 4 le lève objet par objet.

---

## Invariant d'intégration : les listes sont des portes

> **Tout objet du graphe doit être ouvrable depuis l'écran qui le liste.**
> (Vincent, 2026-07-20)

La règle ci-dessus dit *où mène* une porte. Celle-ci dit *combien de portes* doivent
exister. Les deux se complètent : une destination unique ne sert à rien si un seul
chemin y conduit.

Un objet doté d'une adresse, d'une fiche et d'un fil, mais que seule la recherche
sait ouvrir, est **à moitié intégré**. L'utilisateur qui regarde la liste des
réserves de son chantier a l'objet sous les yeux et ne peut pas l'ouvrir : il doit
deviner qu'il faut passer par la recherche pour atteindre ce qu'il voit déjà.

**Les listes métier sont des portes d'entrée du graphe, au même titre que la
recherche.** Elles appliquent donc la même règle de destination — elles ouvrent
l'objet, jamais son conteneur, et jamais par une adresse à elles.

Portée : Réserves, Documents, Réunions, Observations, Actions, Décisions — et tout
objet à venir. Ce n'est pas une correction, c'est la suite logique de l'adressage.

État au 2026-07-20 : **non tenu**. La fiche Réserve n'est ouvrable que depuis la
recherche ; `/sites/<id>/reserves` ne pointe pas vers elle. Inscrit dans les travaux
d'intégration du graphe, hors du Lot 4 qui livre les objets eux-mêmes.
