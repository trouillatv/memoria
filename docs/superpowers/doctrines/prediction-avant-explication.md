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

---

## Corollaire : vérifier que le scénario EXISTE avant de suspecter le code

> **Quand une recette échoue, vérifier d'abord que le scénario existe dans les
> données, avant de suspecter le code.** (Vincent, 2026-07-20)

C'est le même défaut que le « ÷3 », déplacé dans le temps : conclure une cause
avant de l'avoir établie. Une recette rouge dit qu'un écran n'a pas produit le
résultat attendu — elle ne dit pas *pourquoi*, et « le code est faux » est
seulement l'hypothèse la plus disponible.

Cas fondateur (fiche Document, 2026-07-20) : l'adresse d'un document légitime
rendait « Page introuvable ». Le premier réflexe a été de suspecter les gardes qui
venaient d'être écrites. La vérification a montré l'inverse : le document
appartenait à une **autre organisation** que la session ouverte, et la garde
fail-closed faisait exactement son travail. « Corriger » aurait ouvert une faille
d'isolation pour réparer un défaut qui n'existait pas.

Ordre à tenir devant une recette rouge :

1. **le scénario existe-t-il ?** — les données permettent-elles seulement de
   l'exercer (bon tenant, bon rôle, objets liés présents) ;
2. **le comportement observé est-il correct ?** — un refus peut être la réponse
   juste ;
3. **alors seulement**, suspecter le code.

## Un troisième état : NON OBSERVABLE

VALIDÉ et NON VALIDÉ ne suffisent pas. Il existe un cas où le mécanisme est écrit,
compilé, testé et déployé, mais où **le jeu de données ne permet pas de l'exercer**.

> **NON OBSERVABLE** — le comportement n'a pas été vu, et ne peut pas l'être en
> l'état des données. Ce n'est ni une preuve, ni un échec.

L'état existe pour empêcher deux erreurs symétriques :

- **déclarer validé** ce qui n'a jamais été vu ;
- **bloquer un lot** sur un jeu de données qui ne permet pas de l'exercer.

Il s'écrit toujours avec sa cause, jamais seul — sans quoi un futur lecteur le
lira comme un oubli ou un échec. Exemple, tel qu'il doit être consigné :

> Fiche Document — famille « objet protégé » : mécanisme de sécurité **observé**
> (refus cross-tenant en production, sans révéler l'existence) ; parcours métier
> **non observable** avec le tenant de démonstration actuel, qui ne contient aucun
> document rattaché à un chantier.

Et il porte une dette de vérification : ce qui rendra le scénario possible doit
être nommé. Ici, la Réserve — c'est elle qui donnera au Document ses preuves à
justifier. On attend que le modèle métier produise la donnée, plutôt que de la
fabriquer pour faire passer une recette : ce serait confondre enrichir un jeu de
démonstration et valider un mécanisme.
