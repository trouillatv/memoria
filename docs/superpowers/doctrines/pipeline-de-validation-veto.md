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

## L'observateur fait partie de ce qu'on vérifie

> **Une preuve ne vaut que si l'observateur est lui-même fiable.** (Vincent, 2026-07-21)

Deux exemples symétriques, tous deux survenus dans la session fondatrice :

- **un outil qui fait croire à un bug** alors que le produit fonctionne — le renderer
  se figeait 10 à 20 s après un clic ; la navigation avait bien eu lieu, mais les
  captures échouaient ou montraient l'état d'avant. Conclusion tirée trois fois :
  « le clic ne fait rien ». Faux ;
- **un outil qui fait croire que tout fonctionne** alors qu'il n'a rien observé — un
  tripwire dont le motif cassait `/bin/sh` et dont le `catch` prenait sa propre panne
  pour un succès ; un `vitest` lancé avec un reporter inexistant, zéro test exécuté,
  code de sortie masqué par un `tail`.

Le second est le plus dangereux : il produit un vert sans mesure.

**Ce qu'on en tire, concrètement** :

1. avant de conclure à un défaut, vérifier que l'outil a réellement observé — cliquer
   ailleurs sur la même page, refaire le geste sur un autre objet, lire la console ;
2. avant de croire un vert, vérifier qu'une mesure a eu lieu — code de sortie réel,
   nombre de tests exécutés, pas seulement l'absence d'erreur ;
3. **séparer l'observation de l'implémentation.** C'est la raison d'être du
   vérificateur et de l'agent de recette : celui qui a écrit le code a un intérêt dans
   le résultat, et un outil silencieux l'arrange.

## Pourquoi les états sont exclusifs

Le contrat ne dit pas « sauf si on est presque sûr ». Il dit que chaque preuve doit
être obtenue.

D'où l'absence de « terminé sauf… » : à la clôture de la session fondatrice, aucun
doute technique ne subsistait sur les lots 3 et 4 — recette verte, suite verte — mais
un commit n'avait pas reçu sa revue. Ils sont restés `EN_VALIDATION_FINALE`. La
distinction n'est pas de la prudence, c'est la différence entre **preuve produit** et
**preuve de validation**.

---

## RÉVISION (2026-07-21) — le veto appartient aux preuves exécutables

Bilan après usage réel : les agents vérificateurs ont trouvé de vrais défauts, mais
ils ont aussi rendu un verdict **faux** (défaut réfuté par un test de 30 secondes en
production, qui avait déjà coûté un correctif fantôme), failli rejeter à tort sur un
artefact de leur propre outillage, et coûté un passage long là où une vérification
ciblée à deux tranchait en quelques minutes. Les preuves décisives de tout le lot
ont été **directes** : une recette en production, une mesure SQL contre la vraie
base — jamais un rapport.

La règle devient :

- **le veto appartient aux preuves exécutables** — code de sortie réel, recette
  navigateur, mesure directe en base. Aucun rapport d'agent n'accepte ni ne rejette
  un lot ;
- un agent sert à l'**inventaire large** et à la relecture qui produit des
  **hypothèses** — et toute hypothèse de revue se démontre avant correction
  (cf. `demontrer-avant-agir.md`), y compris quand elle vient d'un vérificateur ;
- la vérification ciblée se choisit **à deux** : la bonne question posée par le
  propriétaire du produit, exécutée immédiatement.

Ce qui ne change pas : l'auteur ne se certifie jamais lui-même, les six preuves du
contrat de livraison, les quatre états de lot, et « recette non exécutée = lot non
livré ». Seul le **mécanisme** du contrôle change — l'indépendance qui compte est
celle entre l'affirmation et la preuve, pas celle entre deux agents.

### Précision (2026-07-21, plus tard) — le tri entre main et agent

La révision ci-dessus allait trop loin dans un sens : la régression de contexte de
la fiche Intervenant (le saut vers une Action jetait `?tab=`) n'aurait été vue **ni
par une vérification à la main, ni par la recette** — sur l'onglet par défaut, une
URL nue et `?tab=apercu` rendent le même écran. C'est un agent qui l'a trouvée. Ce
genre de prise justifie de garder le mécanisme.

Le tri, avant de lancer quoi que ce soit :

1. **Vérifiable à la main en quelques minutes** (une requête SQL, un code de
   sortie, une URL à ouvrir, un grep dont on sait quoi chercher) → **on le fait à
   la main, immédiatement.** Jamais d'agent là-dessus.
2. **Structurellement invisible aux vérifications rapides** — composition entre
   fichiers ou montages, états qui rendent identiquement, invariant à balayer sur
   tout le dépôt, régression que la recette ne peut pas distinguer → **agent
   justifié**, sur un périmètre étroit et une mission bornée. Pas « vérifie tout »
   pendant des heures : une question précise, un diff délimité.
3. Un rapport d'agent reste une **hypothèse à démontrer** avant toute correction
   (`demontrer-avant-agir.md`) — c'est ce qui protège du verdict faux, sans
   renoncer aux prises que seul un agent fait.

En une phrase : **la main pour ce qui se mesure vite, l'agent pour ce que ni la
main ni la recette ne peuvent voir — et l'exécution pour départager les deux.**
