# Démontrer avant d'agir

> Établie par Vincent le 2026-07-21, comme généralisation d'une journée entière.

Trois règles, une seule structure — elles remplacent l'intuition par une observation :

> **Avant de développer une capacité, démontrer qu'elle manque.**
> **Avant de corriger un défaut, démontrer qu'il existe.**
> **Avant d'optimiser une fonctionnalité, démontrer qu'elle crée — ou non — de la valeur.**

## Les trois preuves, chacune fondée sur un échec évité le même jour

**Le défaut à démontrer avant de corriger.** Un vérificateur avait déduit un bloquant
cohérent sur le code — une fuite de `person=` dans l'URL. J'ai écrit un correctif, puis
un deuxième, puis un septième. La recette en production a montré que le défaut *n'existait
pas*. Une revue produit une hypothèse ; corriger sur cette seule hypothèse, sans exiger la
démonstration, c'est ce qui a alimenté six tours de régressions.

**La capacité à démontrer avant de développer.** « Il faut développer le résumé de
visite » — il existait déjà, en deux versions. L'inventaire a trouvé 23 capacités IA,
toutes accessibles, zéro code mort. Développer aurait refait l'existant.

**La valeur à démontrer avant d'optimiser.** « Cette capacité est peut-être inutile » —
impossible à dire sans mesure. `ai_usage` prouve qu'une capacité *tourne*, jamais qu'elle
*sert*. Conclure à l'inutilité sans télémétrie de valeur, c'est encore une intuition
déguisée en constat.

## La forme correcte du « pas maintenant »

Une démonstration qui échoue ne condamne pas définitivement l'action — elle la suspend
jusqu'à la preuve. Formulation à tenir :

- ✗ « le lot 5 n'est pas un lot de développement IA » — condamne d'avance une conclusion
  que seule l'observation peut tirer ;
- ✓ « le prochain investissement IA ne doit pas être du développement **tant que** le
  niveau 3 n'est pas compris ».

Le développement redeviendra pertinent quand on saura quelles capacités changent le
comportement. On ne ferme pas la porte, on attend la preuve pour la franchir.

## Pourquoi cette doctrine vaut plus qu'un correctif

Un correctif règle un cas. Cette règle influence toutes les décisions qui suivent : elle
déplace le coût de l'erreur en amont, là où une mesure coûte quelques minutes, plutôt
qu'en aval, où un patch coûte six tours. Le gain d'une journée n'est aucun des composants
écrits — c'est l'amélioration du processus de décision lui-même.
