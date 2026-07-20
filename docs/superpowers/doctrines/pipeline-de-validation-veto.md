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
