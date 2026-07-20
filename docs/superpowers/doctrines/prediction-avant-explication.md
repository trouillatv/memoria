# Une explication n'existe qu'après une prédiction vérifiée

> Établi par Vincent le 2026-07-20, à la clôture du Lot 3.
> C'est l'acquis le moins visible du lot, et probablement le plus durable.

## Le défaut corrigé

En début de Lot 3, plusieurs **hypothèses ont été présentées comme des explications** :

- le « ÷3 » de gain annoncé avant toute mesure ;
- « vraisemblablement `force-dynamic` », énoncé comme une cause ;
- « le navigateur redemande la route de l'onglet », plus affirmatif que la mesure —
  il n'existait en réalité **aucune** requête RSC séparée.

Aucune n'était malhonnête ; toutes étaient prématurées. Le coût d'une hypothèse
déguisée en cause est qu'elle oriente le correctif avant d'avoir été mise en doute.

## L'ordre à tenir

1. **observation** — ce qui est constaté, sans interprétation ;
2. **hypothèse** — nommée comme telle, réfutable ;
3. **prédiction mesurable** — *combien* la correction doit valoir, écrit **avant** ;
4. **expérimentation** — la correction, puis la mesure dans les mêmes conditions ;
5. **conclusion** — l'écart entre prédit et mesuré, gain comme réfutation.

## Le critère qui tranche

> **Une répartition mesurée n'est pas une cause démontrée tant que le correctif n'a
> pas produit le gain attendu.**

La preuve retenue est donc la **prédiction vérifiée**, jamais le gain brut : le modèle
annonçait qu'une vague supprimée vaudrait ~185 ms, la sonde en a mesuré 190. Le
bout-en-bout (1028–1758 ms) varie trop pour prouver quoi que ce soit.

## Conséquences pratiques

- **Un résultat négatif est un résultat.** L'hypothèse de performance du prototype a
  été réfutée ; le prototype est réussi. *Un prototype n'a pas à réussir, il a à
  répondre.*
- **Une sonde se supprime.** L'instrument de mesure n'est pas un acquis du produit.
- **On arrête de mesurer** dès qu'une cause > 70 % est identifiée : corriger, remesurer,
  passer au lot suivant. Ne pas transformer l'enquête en projet.
- **On ne rouvre pas** un chapitre clos, sauf si une **nouvelle mesure** contredit ses
  conclusions.

Cette discipline s'applique aux ADR, aux recettes et aux commentaires de code. Elle vaut
au-delà de la performance : partout où une cause est avancée.
