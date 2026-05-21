# Analyse émotive du projet MemorIA

> *« Ce qu'on a vécu en construisant ce produit. Le récit subjectif des moments où quelque chose a basculé. »*

**Date** : 2026-05-22
**Statut** : Récit. À enrichir à chaque moment émotionnellement structurant.

---

## L'origine — l'idée d'un cousin (printemps 2025)

Le projet ne naît pas d'un brief produit. Il naît d'une discussion familiale.

Vincent observe son cousin qui dirige une entreprise de nettoyage en Nouvelle-Calédonie (AGP, Nouméa). Il voit un secteur **encore à l'âge d'Excel + Facebook**, des chefs d'équipe qui galèrent en mémoire propre, des AO perdus parce que le dossier est mal préparé, des clients mécontents parce que les preuves manquent.

Vincent est SI/Data/IA. Il a le bon profil pour fabriquer quelque chose. Et il a quelque chose de rare : **l'envie sincère d'aider quelqu'un de proche**.

Cette origine compte. Elle a deux conséquences durables :

1. **Le produit n'est pas conçu pour gagner de l'argent en premier.** Il est conçu pour résoudre un vrai problème terrain qu'on observe de près. Cette absence de pression commerciale initiale est ce qui permet la doctrine — *« contextualiser, pas générer »*, *« silence positif »*, *« pas RH »* — d'être tenue.

2. **Le pilote est aimable.** Guillaume (le cousin) sera plus indulgent qu'un client payant. Il acceptera les bugs, les itérations. C'est un luxe stratégique.

> *« Ça fait un moment que je travaille sur une idée, en fait, notamment avec mon père qui était dans le bâtiment public. Je voyais que les preuves de terrain étaient de plus en plus importantes. Du coup, je me suis penché un petit peu là, on a eu le temps. »*

Le projet a aussi ses racines dans une **filiation** — le père de Vincent, dans le bâtiment public. Une mémoire familiale du terrain.

---

## La conversation fondatrice avec ChatGPT (printemps 2025)

C'est dans cette conversation (382 pages d'export PDF) que tout est posé :

- **6 agents IA** au lieu d'un seul prompt
- **App terrain mobile** ultra simple
- **Bibliothèque AO centralisée**
- **Photos avant/après** comme preuves
- **Historique client** pour répondre quand un client conteste
- **Pas une super app SaaS complexe** — *« zéro usine à gaz »*

Et déjà, ce qui deviendra la doctrine :

> *« Le vrai sujet : vitesse + standardisation + réutilisation intelligente. »*
>
> *« Le plus gros levier sous-estimé : la donnée. »*

Vincent ressort de cette conversation avec **un plan complet**. Il ne va pas le suivre à la lettre, mais l'esprit reste.

---

## Le moment du nom — MemorIA (et non NetoIAge)

Petite décision énorme.

Au début, le produit s'appelle NetoIAge — contraction de *« Nettoyage + IA + âge »*. C'est concret, sectoriel, mémorable. Mais Vincent le change.

**MemorIA** s'impose. Pourquoi ?

Parce que le mot inscrit le pari produit dès l'origine : **la mémoire**, pas le nettoyage. Le secteur d'activité est un **terrain d'expérimentation**, pas la définition. Si le produit s'appelait NetoIAge, il serait condamné à rester un SaaS nettoyage. En s'appelant MemorIA, il garde l'option de devenir autre chose.

Ce nom est probablement la première décision **émotionnellement adulte** du projet : se priver d'un nom mémorable pour préserver un futur incertain.

---

## La première itération mock — mai 2026

Les premiers screenshots dans le PDF montrent une app fonctionnelle mais en mode **mock** (`AI_PROVIDER=mock`). Les agents IA produisent des réponses bidons avec un avertissement explicite : *« Mode mock — pas basée sur le PDF réel »*.

Vincent code beaucoup. Il bricole, il itère. Il y a des bugs visibles dans les captures : dropdowns qui se superposent, layouts qui glissent, boutons trop larges. C'est encore brouillon.

Mais le **squelette** est là. Et le squelette est juste : Site / Contrat / Intervention / Équipe / AO. Les 5 piliers sont visibles dès les premiers écrans.

Émotion à ce moment : **excitation prudente**. Le produit fonctionne, mais on n'est pas encore sûr qu'il sert vraiment.

---

## Le moment de la doctrine — 20 mai 2026

C'est ici que le projet **change de nature**.

Vincent ouvre une journée de cadrage stratégique. Il ne code pas. Il pose des **doctrines** :

- 5 piliers
- Tagline (« mémoire exploitable au bon moment »)
- Moat (« contextualiser pas générer »)
- Roadmap ABCDE
- Refus ERP RH / pointage / GPS
- Discipline coût IA
- Litige : jamais lecture automatique
- Écho juste, pas vérité

C'est une journée de **maturation**. Le projet cesse d'être une suite d'idées et devient un système avec des règles. Émotionnellement, c'est le passage de l'adolescence à l'âge adulte du produit.

> *« Toute ouverture doctrinale livre ses garde-fous CI dans le même changement. On ne re-litige pas sous pression terrain. »*

Cette phrase, écrite ce jour-là, devient une règle qui protégera tout le reste.

---

## La transgression assumée — 20-21 mai 2026

Quelques jours plus tard, **première crise doctrinale réelle**.

Guillaume (le pilote) a besoin d'une vue par personne. Il ne peut pas gérer la continuité sans savoir *« qui connaît quel site »*. La doctrine V6 dit *« personne jamais sujet d'évaluation »*. Conflit.

Vincent doit choisir :
- Refuser → le pilote ne marche pas
- Accepter aveuglément → la doctrine s'effondre
- **Transgresser sous garde-fous techniques explicites**

Il choisit la 3ᵉ voie. 6 garde-fous obligatoires : audit log, pas de score, pas de comparaison, wording descriptif, kill switch, tripwire allowlist.

Émotion : **inconfort lucide**. Vincent sait qu'il prend un risque. Il l'assume mais l'encadre. C'est la première fois où le projet montre une capacité à **plier sans casser**.

> *« C'est une transgression assumée. »*

Ce n'est pas une expression rhétorique. C'est une posture précise : on transgresse, on l'écrit, on installe les garde-fous, et on regarde si ça tient.

---

## Le mode d'emploi pour Guillaume — 21 mai 2026

Vincent demande un manuel utilisateur **lisible par un non-tech**. Pas une spec, pas un dev guide. Un manuel destiné à Guillaume.

C'est un geste **affectif**. On ne fait pas un mode d'emploi pour quelqu'un qu'on ne respecte pas. On le fait pour permettre à l'autre de se débrouiller seul, dignement.

Le mode d'emploi de 800+ lignes est livré (`docs/MODE_EMPLOI.md` + `.docx`). 20 sections + FAQ + glossaire. Avec, en plein milieu, une section **doctrine** qui dit à Guillaume :

> *« Hors-UI = encore plus prudent. Tu peux casser doctrinalement le produit en 2 phrases sur WhatsApp. »*

C'est un manuel honnête. Il ne flatte pas. Il responsabilise.

---

## Le tournant — 22 mai 2026 (matin)

Vincent demande *« allons plus loin sur le module Équipes »*.

Sprint A (identité visuelle), sprint B (fiche enrichie), sprint C (passage de témoin). 3 sprints livrés en 6 heures.

Au moment où le sprint C est livré, **quelque chose se passe**. Vincent revient avec une analyse — partagée avec un autre LLM probablement — qui met des mots sur ce qui vient de se passer :

> *« Vous avez probablement touché le premier vrai noyau émotionnel de MemorIA. »*
>
> *« Le passage de témoin automatique change la nature du produit. Ce n'est plus un dashboard, ni un système de tickets, ni un copilote IA. C'est un système qui empêche la perte de mémoire humaine. »*
>
> *« Et ça, c'est rare. »*

C'est le moment où **le projet sort de la catégorie outil pour entrer dans la catégorie système**.

Émotion à ce moment précis : **gravité légère**. On comprend qu'on tient quelque chose qui dépasse l'intention initiale. Et qu'il faut désormais en être à la hauteur.

> *« Vous êtes en train de construire un système de continuité cognitive opérationnelle. »*

---

## Les implications immédiates — 22 mai 2026 (après-midi)

Le tournant déclenche **un cascade de cadrages** :

- **Philosophie de l'oubli** — la mémoire devient toxique si elle n'oublie pas
- **Temps mémoriel** — MemorIA a un *temps propre*, distinct du temps de l'app
- **Discipline d'apparition** — anti-surconstruction, test 4 questions obligatoire
- **Brief = moment magique** — `/h/[token]` est la vitrine, pas un détail
- **Continuité anticipée** (Sprint E) — proposée mais **différée** pour ne pas installer la perception *« système qui sait qui va partir »*

Émotion à ce moment : **vertige stratégique**. On voit soudain 12 mois de travail clairs devant nous. Et la peur de glisser dans la surconstruction.

> *« La vraie compétence produit devient la discipline d'apparition. Pas "peut-on montrer cette mémoire ?" mais "ce moment mérite-t-il vraiment que la mémoire surgisse ?". »*

---

## Les peurs persistantes

À ce stade du projet, plusieurs peurs cohabitent :

### 1. La peur du brief fantôme
Que Joseph reçoive un brief avec 38 anomalies dont 80% sont anciennes ou résolues, et qu'il conclue *« ce site est un enfer »*. Que MemorIA devienne **anxiogène** au lieu de rassurant.

**Mitigation** : Sprint D livré le 22 mai 2026 — décroissance temporelle, résolution explicite, âge visuel. Mais le risque reste tant que Guillaume n'a pas vécu plusieurs briefs réels.

### 2. La peur de la transgression irréversible
Que le Sprint E (continuité anticipée) installe la perception *« MemorIA est le système qui sait qui va partir »*. Cette perception, une fois installée, ne s'efface pas.

**Mitigation** : Sprint E différé jusqu'à observation pilote validée.

### 3. La peur du moat fragile
Que le passage de témoin soit copié par un concurrent qui n'a pas l'architecture sous-jacente, mais qui fait *« suffisamment bien »* pour confondre le marché. Le moat par effet de stack est réel mais invisible pour un acheteur pressé.

**Mitigation** : insister sur la **qualité des briefs** (lecture, pertinence, fraîcheur) comme différenciateur perceptible. Le moat technique n'est pas visible, mais l'**effet** l'est.

### 4. La peur de la surconstruction
Que le produit grossisse vite et perde sa simplicité. Le PDF originel disait *« zéro usine à gaz, ultra pragmatique »*. À mesure qu'on ajoute des features, on s'en éloigne.

**Mitigation** : doctrine **discipline d'apparition** + backlog des « moments écartés ».

### 5. La peur du hors-UI
Que Guillaume casse doctrinalement le produit en utilisant les screenshots Intervenants pour préparer un entretien annuel. Le code ne peut pas l'empêcher.

**Mitigation** : audit log visible côté admin (recommandation R1 du sprint Intervenants — non livré). Reporting trimestriel d'usage. **Mais le verrou final est humain.**

---

## Les fiertés silencieuses

### 1. La doctrine tenue
Aucune fonctionnalité n'a glissé vers le RH. Pas de pointage personne. Pas de score agent. Pas de classement. Le code interdit explicitement (`forbidden-symbols.test.ts`). **Ça tient.**

### 2. Le silence positif
Le dashboard est volontairement frugal. Quand rien ne mérite d'apparaître, rien n'apparaît. C'est contre-instinctif et c'est ce qui fait la qualité.

### 3. Le snapshot immuable
Le brief, une fois généré, ne change plus. Cette décision technique est devenue une **promesse opérationnelle** — *« on peut prouver ce qu'on a transmis »*.

### 4. Le partage public sans friction
`/h/[token]` est consultable sans login, mobile-first, QR code prêt à screenshoter pour WhatsApp. C'est la **vitrine** du produit. Personne ne fait ça aussi bien dans ces secteurs.

### 5. La filiation conservée
Le projet a démarré pour aider un cousin. Il aide toujours un cousin. **Il n'a pas oublié pour qui il est fait.**

---

## Ce qui reste en suspens

### Le pilote n'a pas encore commencé
Au moment où ces lignes sont écrites, Guillaume n'a pas encore utilisé MemorIA en production. Tout ce qui précède est **théorique sous validation pilote**. Le critère ultime reste : *« Guillaume ouvre-t-il spontanément MemorIA chaque jour ? »*

### L'analyse marché élargie n'est pas faite
Le repositionnement vers la « continuité opérationnelle » ouvre des secteurs (hôpitaux, sécurité, BTP) mais aucune validation concrète sur ces secteurs n'existe encore.

### La question commerciale
Vincent est SI/Data/IA, pas commercial. Comment vendre un système de continuité opérationnelle à un dirigeant de PME qui ne sait pas qu'il en a besoin ? Cette question reste ouverte.

---

## La phrase qui résume

> **MemorIA est un projet qui a commencé par vouloir aider un cousin à mieux répondre à des appels d'offres, et qui est en train de devenir un système qui empêche la perte de mémoire humaine dans les opérations terrain.**
>
> **Entre ces deux phrases, il y a 12 mois, 4 sprints, 4 migrations, des doctrines, des transgressions assumées, et le luxe rare d'avoir le temps de faire bien.**

---

## Liens

- [Vision Produit](vision-produit.md) — la phrase
- [Continuité opérationnelle](continuite-operationnelle.md) — le tournant
- [Doctrine RH](doctrine-rh.md) — la frontière qui tient
- [Passation](passation.md) — le mécanisme cœur
- [EVOLUTION_CONCEPTUELLE.md](../EVOLUTION_CONCEPTUELLE.md) — le récit chronologique technique
