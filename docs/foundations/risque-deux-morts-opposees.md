# Le risque des deux morts opposées

> **MemorIA peut mourir de deux façons opposées. Le travail produit est de rester exactement au milieu.**

**Date du cadrage** : 2026-05-22
**Statut** : Risque existentiel reconnu. À mesurer en observation pilote.

---

## L'observation

Les risques produit classiques sont **asymétriques** : il y a une mauvaise direction à éviter, et on calibre pour ne pas y aller. Augmenter X est bon, diminuer X est mauvais.

Pour MemorIA, le risque est **bilatéral** : toute dérive vers un extrême est fatale.

> *« Le projet pourrait mourir de deux manières opposées :
>
> Cas 1 — Pas assez intelligent → remplacé par un ERP classique.
> Cas 2 — Trop intelligent → système anxiogène, trop bavard, trop omniprésent, trop surveillant.
>
> Maintenant votre travail est de rester exactement au milieu. »*

C'est une **dimension produit qu'on ne mesure habituellement pas**. Elle exige une **discipline de centrage** continue.

---

## Cas 1 — Sous-intelligence (mort par banalité)

### Symptômes
- MemorIA ressemble à un dashboard classique
- Pas de différenciation visible vs ERP nettoyage type Kimi
- Les briefs sont vides ou superficiels
- Pas d'éclair de pertinence
- Les résonances ne disent rien d'utile
- Le bouton « Préparer la passation » génère un brief que Joseph aurait pu déduire sans MemorIA

### Conséquence
- Pas de wow, pas de switch
- Projet abandonné après essai pilote
- Remplacé par un produit moins cher / plus intégré
- *« C'est joli mais ça change pas grand-chose à mon quotidien. »*

### Causes possibles
- Trop de silence positif → l'IA se tait quand elle devrait parler
- Filtres anti-bruit trop agressifs → on perd les vrais signaux avec le bruit
- Sources documentaires non embeddées → la mémoire commerciale ne ressort pas
- Manager n'utilise pas les outils livrés (Atelier IA, Mémoire commerciale)

### Antidote
- Auditer la qualité réelle des sorties IA (jury 4 classes)
- S'assurer que les éclats de pertinence arrivent **régulièrement**
- Mesurer le ratio *« écho juste »* vs *« parasite »* (doit rester > 60% en croisière)

---

## Cas 2 — Surconstruction (mort par anxiété)

### Symptômes
- Trop de surfaces parlent en même temps
- Joseph reçoit un brief avec 30 anomalies (« ce site est un enfer »)
- Le manager passe 20 minutes à comprendre une page
- Les chefs d'équipe ressentent une présence « surveillante »
- Bouton Feedback rempli de *« trop d'info »*, *« pas clair »*
- Dashboard avec 12 cartes visibles simultanément
- Notifications push à tout va

### Conséquence
- Rejet psychologique
- Étiquette **« flicage »** collée durablement
- Projet enterré socialement (équipes refusent)
- Risque RGPD / juridique si la perception « surveillance » s'installe
- *« Cet outil m'angoisse, je préfère revenir à Excel. »*

### Causes possibles
- Décroissance temporelle insuffisante → tout l'historique parle
- Pas de résolution explicite → les problèmes anciens hantent
- Trop d'apparitions IA simultanées → fatigue cognitive
- Wording évaluatif glisse vers la personne
- Élargissement de surface RH sans garde-fous (cf. [doctrine-rh.md](doctrine-rh.md))

### Antidote
- Sprint D (mémoire qui sait vieillir) — livré
- Discipline d'apparition à 6 dimensions ([qualite-dapparition.md](qualite-dapparition.md))
- Tripwires CI pour interdire les dérives lexicales
- Bouton Feedback monitoré quotidiennement pendant le pilote

---

## Métriques de centrage

Le centre est un **équilibre instable**. Pour le surveiller, métriques à instrumenter dans le dashboard d'observation pilote :

| Métrique | Cible centre | Alerte sous-intelligence | Alerte surconstruction |
|---|---|---|---|
| Éléments visibles / dashboard | 4-7 | < 2 (rien à montrer) | > 10 (surcharge) |
| Ratio pages silencieuses | ~30% | < 10% (tout parle) | > 60% (rien ne parle) |
| Latence 1er clic utile | < 5s | n/a | > 15s (perdu) |
| Feedback *« trop X »* | < 2 / mois | n/a | > 5 / mois |
| Feedback *« j'ai pas compris »* | < 2 / mois | n/a | > 5 / mois |
| Briefs créés | 2-10 / sem | 0 (invisible) | > 30 (compulsion) |
| Connexions spontanées Guillaume | 3-7 / sem | < 1 (oublié) | > 14 (anxieux) |
| Ratio écho juste / parasite | > 60% justes | < 40% (bruit) | n/a |

---

## La discipline du centre

Le travail produit pendant 12 mois n'est plus *« construire plus »*. C'est :

1. **Calibrer** ce qui existe — chaque surface à 6 dimensions cohérentes
2. **Resserrer** ce qui parle trop — filtre, atténuation, cap
3. **Donner du volume** à ce qui se tait alors qu'il devrait alerter — révéler des signaux enterrés
4. **Mesurer** continuellement pour détecter les dérives bilatérales

Ce n'est ni du dev ni du design pur. C'est de la **conduite produit fine**.

---

## La méthode : observation pilote

L'observation longue réelle est la seule méthode pour **rester au centre**. Pas de modèle théorique, pas de prédiction.

Pendant 14 à 30 jours :
- **Aucune nouvelle feature** (gel)
- **Dashboard d'observation pilote** instrumenté
- **Lecture quotidienne** du tableau de bord par Vincent
- **Lecture des feedbacks** in-app
- **Conversation hebdo avec Guillaume** pour qualifier ce que les chiffres ne disent pas

À la fin de l'observation, **3 décisions possibles** :

1. **Centre tenu** → on continue la roadmap (Sprint suivant, polish, …)
2. **Dérive sous-intelligence** → ouvrir une primitive (ex. enrichir l'Atelier IA pour qu'il sorte plus de pertinence)
3. **Dérive surconstruction** → resserrer (cap, filtre, atténuation, retrait de surface)

---

## Doctrines liées

- [Vision Produit](vision-produit.md) — pourquoi le centre compte
- [Qualité d'apparition](qualite-dapparition.md) — la grille pour calibrer fin
- [Doctrine de la mémoire](doctrine-memoire.md) — silence positif, discipline d'apparition
- [Primitives produit](primitives-produit.md) — chaque primitive est un levier de centrage
- [Doctrine RH](doctrine-rh.md) — la frontière qui protège du cas #2
- Memory : [[risque-deux-morts-opposees]], [[ordre-sprints-post-passage-temoin]]
