# Validation S3 — Les nœuds de mémoire (sous-périmètres)

**But du test : on ne teste PAS le code.** Le code est validé (la page charge, les
compteurs sont justes). Et surtout, **on ne teste pas « les scopes ».**

Le scope est un **moyen, pas une fin.** Personne ne se réveille en disant « j'ai
besoin d'un système d'adressage hiérarchique de mémoire ». Les gens disent « quand
Michel part en vacances je suis dans la merde », « on a déjà résolu ce problème il
y a deux ans mais personne ne sait comment », « je passe ma vie à chercher ». Le
client n'achètera jamais un scope. Il achète :

> **« Je retrouve immédiatement ce que mon entreprise sait déjà. »**

Le danger de cette phase est de tomber amoureux de l'architecture. **L'utilisateur,
lui, doit tomber amoureux du résultat.** Donc on teste le **besoin**, pas la
feature. Une seule vraie question, impossible à prédire :

> Mis devant une vraie douleur, l'utilisateur **découvre-t-il de lui-même** qu'il
> faut aller chercher « dans le VRD » ?

---

## Règles de passation (à respecter strictement)

- **2 à 3 personnes**, idéalement profil terrain (conducteur, chef de chantier).
- **Aucune explication préalable.** Pas de « voilà notre nouvelle feature ». On
  pose une situation, on se tait, on écoute.
- **On ne souffle jamais la réponse.** Le silence est une donnée. L'hésitation est
  une donnée. On note les mots exacts de la personne.
- **Deux temps, dans cet ordre** : (1) le test de découverte par la douleur —
  **sans rien montrer** ; (2) seulement après, on révèle l'outil et on teste la
  compréhension / la valeur. **L'ordre est non négociable** : montrer l'arbre
  d'abord souffle la réponse et détruit le test n°1.
- Un observateur note, ne commente pas.

---

## TEMPS 1 — Découverte par la douleur (AVANT de montrer quoi que ce soit)

Le test le plus important. On ne montre pas l'écran. On ne dit ni « scope », ni
« sous-périmètre », ni « mémoire ». On pose une **situation douloureuse réelle** et
on regarde où la personne va spontanément.

### Test A — La passation brutale

> « Jean quitte le chantier. Tu arrives à sa place lundi.
> Comment retrouves-tu **tout ce qu'il sait sur les réseaux EP** ? »

### Test B — Le problème qui revient (variante plus riche)

> « Il y a une infiltration récurrente. Trois entreprises sont déjà intervenues
> dessus. La personne qui suivait le dossier est partie.
> **Où chercherais-tu ?** »

**Ce test mesure DEUX choses distinctes — ne pas les confondre.**

**(a) Le problème est-il réel ?** (le plus important)
- ✅ **Douleur réelle** — « aujourd'hui je fouille les mails », « j'appellerais
  quelqu'un », « je redemanderais à Jean », « on repart de zéro ». **Ce n'est PAS
  un échec** : c'est la preuve que le problème existe. Le coût actuel est verbalisé
  → il y a un marché pour la solution. C'est le **meilleur signal terrain** à
  obtenir maintenant.
- ❌ **Vrai échec** — « bof, pas un souci », « je retrouverais facilement », « ça
  n'arrive jamais ». Pas de douleur → pas de marché. Là, ni S3 ni S4 ne servent à
  rien.

**(b) Découvrent-ils l'adressage tout seuls ?** (bonus, pas obligatoire)
- ✅✅ **Idéal** — « j'irais dans le VRD », « dans tout ce qui touche au VRD », « la
  mémoire du VRD ». Sans qu'on ait montré l'outil, la personne a *inventé* le
  rangement adressable. Signal le plus fort de la fiche.
- Si elle ne le trouve pas seule mais que la douleur est réelle (a ✅), ce n'est pas
  grave : on révèle l'écran au Temps 2 et on regarde s'il lui apparaît comme une
  **réponse naturelle** à la douleur qu'elle vient de décrire.

> Note : on peut adapter la douleur au métier de la personne (un dégât des eaux, un
> litige fournisseur, une reprise de malfaçon…). Ce qui compte est que la situation
> soit **vraie et coûteuse**, et qu'on ne nomme jamais la solution.

---

## TEMPS 2 — Compréhension de l'outil (on révèle l'écran)

Une fois le Temps 1 fait et noté, on montre — rien de plus :

```text
Médipôle
├─ VRD
├─ Électricité
└─ Gros œuvre
```

Écran réel (compte démo `demo@memoria.nc`) :
`/sites/c8a7d236-c749-46fa-8a7c-fa75fb8770dc?tab=memoire`

---

## Ce qu'on observe (au-delà des réponses)

Les réponses comptent. Mais deux signaux faibles en disent autant.

### Le vocabulaire spontané

Le mot qu'ils emploient sans qu'on le souffle trahit leur modèle mental.

- ✅ **« un lot », « une zone », « une partie du chantier », « un périmètre »** →
  ils voient une *partie adressable* du chantier. Très bon signe.
- ❌ **« un dossier », « un répertoire », « un classeur »** → ils voient un
  *système de rangement*, pas une mémoire adressable. À noter immédiatement : ce
  n'est pas un détail, c'est le cœur du concept qui n'est pas passé.

### Le temps avant compréhension

À mesurer mentalement, du moment où on montre l'écran à la première phrase juste.

- **< 30 s** → excellent, le concept est lisible.
- **30 s – 2 min** → acceptable.
- **> 2 min** → problème de **présentation** (pas forcément de concept) : la page
  ne dit pas assez vite ce qu'elle est.

---

## Les 6 tests

### Test 1 — Compréhension spontanée du concept

> **« À quoi sert *VRD* ici ? »**

✅ **Signal de réussite** — la personne dit, avec ses mots, quelque chose comme
« c'est une partie / un sous-ensemble du chantier ».
❌ **Signal d'alerte** — « aucune idée », ou elle croit que c'est une catégorie de
documents, un service, un nom d'entreprise.

### Test 2 — Le scope est un endroit où vit la mémoire

Cliquer sur **VRD**. Puis :

> **« Qu'est-ce que tu t'attends à trouver ici ? »**

(la question vient **avant** qu'elle lise la page en détail — on capte l'attente,
pas la lecture)

✅ « tout ce qui concerne le VRD » / « ce qu'on sait sur le VRD ».
❌ Elle décrit juste « une liste de tâches » sans voir que c'est *la mémoire du
VRD*. → noter : la page ressemble-t-elle à une liste technique plutôt qu'à une
réponse à « que sait-on sur X ? »

### Test 3 — La limite anti-ERP (LE test qui protège le produit)

> **« Est-ce qu'il faudrait créer un sous-périmètre *Regard EP-17* ? »**

✅ **Signal de réussite** — « Non, seulement si on a souvent besoin d'en parler ».
La personne sent qu'un scope est un **regroupement utile**, pas une ligne d'ERP.
❌ **Signal d'alerte** — « oui, et un pour chaque regard / chaque tâche / chaque
vis ». → le modèle dérive vers l'ERP, le concept n'est pas compris.

### Test 4 — La valeur (la question la plus importante)

> **« Si Jean quitte le chantier demain, est-ce que cette page aide son
> remplaçant ? »**

✅ **« Oui »** franc, avec une raison (« il voit d'un coup ce qu'il y a sur le
VRD »).
❌ « bof » / « pas vraiment ». → **noter ce qui manque**, mais **ne rien ajouter
tout de suite**. Si la réponse est non, ni les photos ni S4 ne sauveront le
concept.

### Test 5 — Le réflexe de navigation (probablement le meilleur test)

Après avoir montré VRD, sans aide :

> **« Si demain tu as un problème sur les réseaux EP, où cliquerais-tu ? »**

✅ **Réponse immédiate : « VRD ».** Le modèle mental est acquis — la personne sait
*adresser* sa mémoire, pas juste lire une page. C'est le signal le plus fort de
toute la fiche.
❌ Elle hésite, cherche un menu, un moteur de recherche global, ou clique au
hasard. → l'adressage n'est pas encore intuitif.

### Test 6 — Le test de soustraction (à poser après les 5 autres)

La question la plus redoutable. Elle ne mesure pas la compréhension, elle mesure
la **dépendance** — la douleur réelle si ça disparaît.

> **« Si on retire cette page demain, qu'est-ce que tu perds ? »**

✅ **Très bon signe** (la douleur est réelle) — « je perds du temps », « je ne
sais plus où chercher », « le remplaçant est perdu », « on repart de zéro ».
❌ **Mauvais signe** (pas de dépendance) — « pas grand-chose », « je retrouverais
autrement », « je chercherais dans les photos ».

C'est ce test qui sépare « validé **intellectuellement** » de « validé
**économiquement** ».

---

## Le vrai danger à guetter

Le risque principal **n'est pas** qu'ils ne comprennent pas. C'est qu'ils
comprennent… **mais ne voient pas l'intérêt** — pire, le scénario le plus subtil :

> « Oui, je comprends. Oui, c'est logique. Oui, je cliquerais sur VRD. »
> … « Mais je ne suis pas sûr que j'en aurais besoin tous les jours. »

Ce cas **valide le concept intellectuellement mais pas économiquement**. Comprendre
l'**interface** ne suffit pas — il faut qu'ils ressentent la **valeur** au point de
la juger indispensable. Un utilisateur peut décrire parfaitement ce qu'est un scope
et rester indifférent : **ça compte comme un échec**, pas une réussite partielle.

La vraie inconnue de cette phase n'est donc pas la compréhension (elle viendra
probablement). C'est : **les utilisateurs ressentent-ils assez la douleur de la
perte de mémoire pour juger ça indispensable ?** Si oui, MemorIA est bien plus
défendable qu'un outil de chantier ou un assistant IA — et c'est précisément ce
qu'on veut savoir **avant** d'investir dans S4.

---

## Grille de notation

Une coche = compris **spontanément** (sans qu'on aide).

| Critère | P1 | P2 | P3 |
|---|:--:|:--:|:--:|
| ⛳ **DOULEUR réelle exprimée** (Temps 1a — prérequis : « je fouille les mails / je repars de zéro ») | ☐ | ☐ | ☐ |
| ★★ A découvert l'adressage seul (Temps 1b — « j'irais dans le VRD », bonus) | ☐ | ☐ | ☐ |
| 1. Un scope = regroupement logique de mémoire (Test 1) | ☐ | ☐ | ☐ |
| 2. On n'en crée pas partout (Test 3, anti-ERP) | ☐ | ☐ | ☐ |
| 3. On peut poser une question sur ce scope (Test 2) | ☐ | ☐ | ☐ |
| 4. Ça aide à transmettre le contexte (Test 4) | ☐ | ☐ | ☐ |
| 5. Réflexe de navigation : sait où cliquer pour un pb EP (Test 5) | ☐ | ☐ | ☐ |
| 6. Dépendance : « ce que je perds » est concret (Test 6) | ☐ | ☐ | ☐ |
| ★ **A vu la VALEUR** (phrase spontanée, cf. go/no-go) | ☐ | ☐ | ☐ |

Par personne, noter aussi : **vocabulaire** employé (lot/zone/périmètre = ✅ ;
dossier/répertoire = ❌) et **temps avant compréhension** (<30 s / 30 s–2 min /
>2 min).

| Mesure | P1 | P2 | P3 |
|---|---|---|---|
| Mot spontané pour « scope » | | | |
| Temps avant la 1ʳᵉ phrase juste | | | |

Verbatims à garder (mots exacts, surtout les hésitations **et** la phrase de
valeur si elle sort) :

- P1 :
- P2 :
- P3 :

**La phrase qu'on espère entendre.** Le meilleur verbatim n'est pas « c'est bien »
ni « c'est logique » (jugements sur un écran). C'est une phrase où la personne
bascule et parle d'un **problème métier**, par exemple :

> « Ah, donc tout ce qui concerne le VRD va vivre ici. »
> « Ah, ça devient la mémoire du VRD. »
> « Quand quelqu'un part, on ne perd plus tout. »

À cet instant elle ne décrit plus une interface : elle décrit la perte de mémoire
qu'on lui évite. Si cette bascule se produit chez ≥2 personnes, S3 est validé.

---

## Critère go / no-go

Trois niveaux, par ordre logique :

0. **Prérequis — la douleur (Temps 1a).** Au moins 2 personnes **verbalisent le
   coût actuel** : « aujourd'hui je fouille les mails / j'appelle quelqu'un / on
   repart de zéro ». Sans cette douleur, **STOP** : pas de problème = pas de marché,
   ni S3 ni S4 ne servent. C'est le **meilleur signal terrain** à viser.
1. **Bonus — la découverte spontanée (Temps 1b).** Mises devant la douleur, elles
   vont d'elles-mêmes « dans le VRD » sans qu'on ait montré l'outil. Pas
   obligatoire, mais c'est le signal le plus défendable (le besoin précède la
   feature).
2. **Confirmation (Temps 2).** Une fois l'écran révélé, il leur apparaît comme une
   **réponse naturelle** à la douleur décrite, elles lâchent une **phrase de valeur
   spontanée** (« je retrouve tout ce qui concerne le VRD », « quand quelqu'un part
   on garde tout au même endroit ») **et** le Test 6 montre une dépendance réelle.

**Feu vert S4** = douleur réelle (niveau 0) **+** l'écran VRD ressenti comme réponse
naturelle (niveau 2), chez ≥2 personnes. La découverte spontanée (niveau 1) renforce
mais n'est pas exigée. Une coche d'interface seule, sans douleur ni phrase de valeur,
= **non validé** : on aura prouvé la lisibilité, pas l'utilité.

- ✅ **Validé** → on passe à **S4 — Recherche scopée**. S3 permet de **ranger** ;
  S4 permet de **retrouver**. Les gens paient rarement pour ranger, très souvent
  pour retrouver. Les **photos viennent après S4**.
- ❌ **Non validé** → on **ne construit rien**. Cas à distinguer : (a) besoin pas
  ressenti au Temps 1 → problème de *positionnement / douleur ciblée*, pas d'UI ;
  (b) besoin ressenti mais outil pas compris au Temps 2 → problème de
  *présentation* (vocabulaire « dossier », page = liste technique). On corrige la
  cause identifiée, on n'ajoute pas de features.

### Roadmap aval (figé par cette décision)

```text
Validation S3  →  S4 Recherche scopée  →  Photos  →  S5 Expérience accumulée
       (ranger)         (RETROUVER)        (voir)      (réutiliser)
```

Raison de l'ordre : le différenciateur de MemorIA n'est pas de **voir** les
preuves ni de **ranger** la mémoire, c'est de pouvoir **retrouver / interroger**
l'expérience accumulée à un niveau précis. Les scopes (S3) ne seront probablement
**jamais le moment « wow »** — ils sont l'**infrastructure qui rend le wow
possible**. Le wow, c'est S4.

### Le nord magnétique de S4 (cible, NON construit — gated par la validation S3)

À garder en tête comme objectif, sans écrire une ligne avant le feu vert S3. Le
premier vrai moment « wow » de MemorIA ressemble à ça :

> **Question :** « Que sait-on sur les infiltrations du Médipôle ? »
> **Réponse, en quelques secondes :** 27 événements sur 4 ans · 3 entreprises
> impliquées · 2 solutions qui ont fonctionné · photos avant/après.

Le jour où quelqu'un voit cette réponse apparaître seul, il comprend
immédiatement pourquoi la mémoire a de la valeur. C'est ce moment qu'on cherche à
rendre possible — et la raison pour laquelle on protège le signal de S3 maintenant
plutôt que de l'enjoliver.

---

## Pourquoi pas de photos / pas de S4 *avant* ce test

- **Photos avant** = on rend la page impressionnante (50 photos) et on ne sait
  plus si c'est le *concept de scope* qui convainc ou juste le visuel. On perd le
  signal.
- **S4 avant** = on teste S3 + S4 mélangés. Si les gens adorent, on ne sait pas
  pourquoi. On ne pourra pas attribuer le succès au bon endroit.

Le test ci-dessus isole **une** variable : la **découverte spontanée du besoin**
(et, en confirmation, la compréhension de l'outil). C'est la seule chose qu'on ne
peut pas prédire — donc la seule qui mérite un test avant d'écrire la moindre ligne
de plus. On protège ce signal au lieu de l'enjoliver : c'est exactement pour ça
qu'on ne construit ni les photos ni S4 maintenant.
