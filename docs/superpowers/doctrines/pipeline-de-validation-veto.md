# Le pipeline de validation, et le droit de veto

> Établi par Vincent le 2026-07-20, après une session où trois preuves sur quatre
> étaient vertes pendant qu'une page plantait en production.

## Le constat qui fonde la règle

La fiche Intervenant a été livrée avec : compilation ✔ · lint ✔ · 959 tests ✔ ·
revue ✔. Elle plantait à l'ouverture (`Cannot destructure property 'store'`).

Aucun test ne pouvait le voir : le défaut était dans le **montage** d'un composant,
pas dans sa logique. Seule l'exécution réelle le révélait.

## La règle

> **Un lot UI n'est livrable que si : compilation · lint · tests · revue
> indépendante · RECETTE NAVIGATEUR.**
> S'il manque le dernier point, **ce n'est pas livré** — pas « livré avec réserve ».

« Recette non exécutée » n'est pas un niveau de confiance dégradé. C'est un état
d'échec de la livraison.

## Le droit de veto

Le vérificateur indépendant ne rend pas un avis, il rend un **verdict** :

```
VERDICT : REJETÉ
Raisons : test rouge · route cassée · fail-open tenant
```

Quand le verdict est REJETÉ, **l'orchestrateur n'a plus le droit d'écrire « lot
terminé »**. Il corrige, puis **relance toute la chaîne** — pas seulement le point
signalé : une correction peut en casser une autre.

Le vérificateur ne peut pas être l'auteur du code qu'il juge. Un rapport d'agent
reste une hypothèse à contrôler : deux fois dans la session fondatrice, un agent a
rapporté des faits inexacts (un test lancé dans un projet qui l'exclut, une table
confondue avec une autre).

## Ce que ça change pour la confiance

La question n'est plus « le rapport de l'agent est-il fiable ? » mais « les quatre
sont-ils d'accord ? » — celui qui code, celui qui vérifie, la suite de tests, et le
navigateur. Tant qu'ils ne le sont pas, il n'y a rien à livrer.

C'est le processus qui devient digne de confiance, pas le rapporteur.

## Les états d'un lot — quatre mots, pas de nuances

Formalisés par Vincent le 2026-07-20 : *« un état unique, immédiatement lisible, qui
évite toute ambiguïté entre "en cours de développement" et "en attente de preuves". »*

| État | Ce qu'il dit exactement |
|---|---|
| `EN_EXECUTION` | Le code s'écrit. Rien n'est prouvé, rien n'est promis. |
| `ATTENTE_ARBITRAGE` | Bloqué sur une décision que les doctrines ne tranchent pas. **Seul état où l'on sollicite Vincent.** |
| `EN_VALIDATION_FINALE` | **Développement terminé, validation bloquante en cours.** Les fonctionnalités existent ; les preuves manquent. |
| `TERMINE` | Les six preuves sont réunies, verdict du vérificateur favorable, recette exécutée. |

Ce que ces états interdisent :

- **« probablement bon »**, « ça devrait passer », « je pense que » — aucun n'est un état ;
- confondre `EN_VALIDATION_FINALE` avec un retour en arrière : le développement ne
  recommence pas, on élève le seuil de preuve ;
- écrire `TERMINE` quand une seule preuve manque. Il n'existe pas de « terminé avec
  réserve » : c'est `EN_VALIDATION_FINALE`.

**Absence de preuve ≠ preuve de succès.** Une suite de tests non relancée ne dit rien —
ni vert ni rouge. Le seul énoncé honnête est « je ne peux rien affirmer ».

## Deux règles sur les tests, apprises en quatre occurrences

### 1. Une assertion négative ignore les commentaires

> **Toute assertion négative portant sur le code source doit s'appliquer à une
> version dépourvue de commentaires, sauf si l'intention est précisément de
> vérifier les commentaires.** (Vincent, 2026-07-20)

Le commentaire fait partie de la **documentation**, pas du **comportement**. Il est
normal qu'il cite un symbole supprimé pour expliquer sa disparition — c'est même
sa raison d'être. Un `not.toContain('action_source')` qui échoue sur la phrase
« `action_source` a été retiré parce que… » ne signale aucun défaut.

Quatre occurrences indépendantes dans la même session (Réserve, `?action=`,
Document, fiche personne). Utilitaire à poser dans le fichier de test :

```ts
const sansCommentaires = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
```

### 2. Un test se couple au comportement, jamais à l'implémentation

Quand une migration fait tomber un test, la première question n'est pas « comment
le réparer » mais **« que protégeait-il réellement ? »**.

Cas fondateur : un test exigeait `set('action', …)` — la construction d'URL par
paramètres. La migration l'a supprimée, le test est tombé. Or ce qu'il devait
protéger n'était pas cette forme, c'était : *depuis la fiche personne, une action
ouvre sa fiche canonique*. Reformulé sur l'intention, il protège la même chose et
survit à la prochaine migration.

**Sa chute était le signe que le correctif marchait** : il exigeait précisément le
mécanisme qui faisait planter la page. Un test couplé à l'implémentation produit
ce faux positif à chaque refonte — et pousse à réparer le test plutôt qu'à lire ce
qu'il dit.

## Ce qui autorise à passer en ATTENTE_ARBITRAGE

> **Avant toute mise en `ATTENTE_ARBITRAGE`, l'orchestrateur doit avoir effectué au
> moins une tentative raisonnable de résolution du problème relevant de son domaine
> de compétence, et documenter cette tentative dans le bloc de reprise.**
> (Vincent, 2026-07-21)

Une suspension ne signifie pas « il y a une erreur ». Elle signifie **« je ne peux
plus progresser de manière autonome »**. La différence est tout le sujet.

**Relève du domaine de compétence — on diagnostique, on corrige, on relance, on ne
demande rien** : erreur de compilation, test cassé, import manquant, erreur de
typage, refactoring oublié, lien mort, régression introduite par le lot.

L'ordre est toujours le même : diagnostiquer → tenter → revérifier → et seulement
si l'on reste bloqué, escalader.

**Justifie une escalade** : une décision métier · plusieurs solutions également
valides · une information manquante que le code ne porte pas (comportement attendu
ambigu, API inconnue) · plusieurs tentatives infructueuses · un moyen qui manque
(un accès, une donnée que le jeu de démonstration ne contient pas).

L'humain est **arbitre**, jamais débogueur de première ligne. Le solliciter sur une
erreur de typage lui fait payer le prix d'une interruption pour une information
qu'il n'a pas à fournir.

**Corollaire sur la forme** : un `ATTENTE_ARBITRAGE` sans tentative documentée est
mal formé. Le bloc de reprise doit dire ce qui a été essayé et pourquoi ça n'a pas
suffi — sans quoi l'arbitre doit refaire le diagnostic avant de pouvoir arbitrer.
