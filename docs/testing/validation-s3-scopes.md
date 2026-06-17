# Validation S3 — Les nœuds de mémoire (sous-périmètres)

**But du test : on ne teste PAS le code.** Le code est validé (la page charge, les
compteurs sont justes). On teste une seule chose, impossible à prédire :

> Est-ce que les utilisateurs comprennent **spontanément** la mémoire adressable ?

Pas « est-ce que les scopes marchent ». « Est-ce qu'un humain, sans explication,
voit qu'un sous-périmètre est un endroit où ranger et interroger la mémoire d'une
partie du chantier. »

---

## Règles de passation (à respecter strictement)

- **2 à 3 personnes**, idéalement profil terrain (conducteur, chef de chantier).
- **Aucune explication préalable.** Pas de « voilà notre nouvelle feature ». On
  montre, on se tait, on écoute.
- **On ne souffle jamais la réponse.** Le silence est une donnée. L'hésitation est
  une donnée. On note les mots exacts de la personne.
- **~10 minutes** par personne. On ne déroule pas une démo : on pose 4 questions.
- Un observateur note, ne commente pas.

### Ce qu'on montre (rien de plus, au début)

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

## Les 5 tests

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

---

## Le vrai danger à guetter

Le risque principal **n'est pas** qu'ils ne comprennent pas. C'est qu'ils
comprennent… **mais ne voient pas l'intérêt** :

> « Oui je comprends VRD. » … « Mais pourquoi je créerais ça ? »

C'est là que tout se joue. Comprendre l'**interface** ne suffit pas — il faut
qu'ils ressentent la **valeur**. Un utilisateur peut décrire correctement ce
qu'est un scope et rester totalement indifférent. Ce cas-là compte comme un
**échec**, pas une réussite partielle.

---

## Grille de notation

Une coche = compris **spontanément** (sans qu'on aide).

| Critère | P1 | P2 | P3 |
|---|:--:|:--:|:--:|
| 1. Un scope = regroupement logique de mémoire (Test 1) | ☐ | ☐ | ☐ |
| 2. On n'en crée pas partout (Test 3, anti-ERP) | ☐ | ☐ | ☐ |
| 3. On peut poser une question sur ce scope (Test 2) | ☐ | ☐ | ☐ |
| 4. Ça aide à transmettre le contexte (Test 4) | ☐ | ☐ | ☐ |
| 5. Réflexe de navigation : sait où cliquer pour un pb EP (Test 5) | ☐ | ☐ | ☐ |
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

---

## Critère go / no-go

**S3 est VALIDÉ si au moins 2 personnes** comprennent spontanément les critères
ci-dessus **ET voient la valeur**.

Le vrai signal de validation n'est pas une coche : c'est une **phrase de valeur
spontanée**, du genre :

> « Ah oui, ça évite de chercher dans tout le chantier. »
> « Ah oui, je peux retrouver tout ce qui concerne le VRD. »
> « Ah oui, quand quelqu'un part, on garde tout au même endroit. »

À ce moment-là, la personne a compris la **valeur**, pas seulement l'interface.
Sans cette phrase (même si les 5 tests sont « compris »), considérer S3 comme
**non validé** : on aura prouvé la lisibilité, pas l'utilité.

- ✅ **Validé** → on passe à **S4 — Recherche scopée** (« Que sait-on sur le VRD
  du Médipôle ? » → réponse ciblée). C'est là que commence le vrai
  différenciateur : interroger l'expérience accumulée à un niveau précis. Les
  **photos viennent après S4** (elles embellissent mais masqueraient le signal si
  ajoutées maintenant).
- ❌ **Non validé** → on **ne construit rien**. On identifie ce qui n'est pas
  compris (vocabulaire ? la page ressemble trop à une liste ? la valeur de
  transmission n'est pas évidente ?) et on corrige *le concept / la présentation*,
  pas en ajoutant des features.

### Roadmap aval (figé par cette décision)

```text
Validation S3  →  S4 Recherche scopée  →  Photos  →  S5 Expérience accumulée
```

Raison de l'ordre : le différenciateur de MemorIA n'est pas de **voir** les
preuves, c'est de pouvoir **interroger** l'expérience accumulée à un niveau précis
de l'organisation. Les photos servent ce moteur, elles ne le précèdent pas.

---

## Pourquoi pas de photos / pas de S4 *avant* ce test

- **Photos avant** = on rend la page impressionnante (50 photos) et on ne sait
  plus si c'est le *concept de scope* qui convainc ou juste le visuel. On perd le
  signal.
- **S4 avant** = on teste S3 + S4 mélangés. Si les gens adorent, on ne sait pas
  pourquoi. On ne pourra pas attribuer le succès au bon endroit.

Le test ci-dessus isole **une** variable : la compréhension spontanée de
l'adressage. C'est la seule chose qu'on ne peut pas prédire — donc la seule qui
mérite un test avant d'écrire la moindre ligne de plus.
