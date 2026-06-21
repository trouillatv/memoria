# Validation — Le Sujet raconte-t-il l'histoire ?

**But du test : on ne teste PAS le calcul.** Le calcul est validé (état, cause,
énergie sont justes — vérifiés en round-trip). On ne teste pas non plus « la page
Sujet » comme feature.

La seule question qui compte n'est plus :

> Le calcul est-il **correct** ?

mais :

> Le sujet est-il **utile** ? Est-ce qu'il explique réellement la situation —
> au point qu'on n'ait PAS besoin de rouvrir le CR pour comprendre ?

Un attribut peut être parfaitement exact et totalement inutile. C'est ce piège-là
qu'on cherche. **« Correct mais je rouvre le CR quand même » = échec**, pas succès.

Et le test ultime, la phrase qu'on attend de Guillaume ou d'Émeline, sans la
souffler :

> **« Oui, c'est exactement ce que j'avais besoin de comprendre. »**

Si cette phrase arrive de elle-même, on est sur la bonne trajectoire et on pourra
cadrer les dépendances entre sujets. Si elle n'arrive pas, on corrige l'utilité
**avant** d'ajouter quoi que ce soit.

---

## Règles de passation

- **Guillaume (VRD / exécution) ET Émeline (MOE / pilotage)** — les deux regards.
- **Revue métier, pas technique.** Aucune explication de « comment c'est calculé ».
- **On ne souffle jamais la réponse.** L'hésitation est une donnée. On note les
  mots exacts. Le « ouais… c'est correct » mou est aussi parlant qu'un « ah oui ! ».
- Un observateur note, ne commente pas.

---

## Le protocole (≈ 15 min)

Choisir **4 sujets réels** (variés exprès) :

- un **DOE**
- une **réserve** (ou un sujet qui en porte une, non levée)
- un **sujet parking**
- un **sujet VRD**

Pour chacun : ouvrir la **page Sujet** et lire **uniquement le bloc « État du
sujet »** (état · cause · confiance · dernière évolution · prochaine étape ·
question ouverte). Sans rouvrir le CR.

Puis répondre, en une phrase chacun :

| Attribut | Question métier (pas « est-ce juste » — « est-ce utile ») |
|---|---|
| **État** | Correspond-il à ce que vous diriez à l'oral de ce sujet ? |
| **Cause** | Dit-elle vraiment **pourquoi c'est encore ouvert** — ou juste quelque chose de plausible ? |
| **Dernière évolution** | Est-ce **le** fait que vous auriez retenu, ou un détail ? |
| **Prochaine étape** | Est-ce celle que **vous** auriez écrite ? |
| **Question ouverte** | Est-ce celle que vous **poseriez en réunion** ? |

Pour chaque attribut, classer en un mot : **utile** / **correct mais inutile** /
**faux** / **vide**.

> Le plus précieux à récolter, c'est **« correct mais inutile »**. C'est là qu'on
> apprend la différence entre un calcul et un produit.

---

## La question finale (la seule qui tranche)

Après les 4 sujets, une seule question, posée telle quelle :

> **« En lisant ce bloc, avez-vous compris la situation du sujet — sans rouvrir le
> CR ? »**

- **Oui, spontanément** → utile. On peut avancer (cadrage `subject_link`).
- **« C'est correct, mais je rouvre quand même le CR »** → seulement correct. On
  note **pourquoi** le bloc ne suffit pas. C'est notre prochaine vraie tâche.

---

## Ce qu'on ne fait PAS à l'issue de ce test

- Pas de nouvelle feature « parce qu'on y est ».
- Pas de `subject_link` / dépendances entre sujets **tant que la phrase
  « c'est exactement ce que j'avais besoin de comprendre » n'est pas arrivée.**

Le risque, à ce stade, n'est plus de manquer une fonctionnalité. C'est de repartir
dans « encore une feature » alors qu'on vient peut-être de trouver le véritable
objet métier du produit : **le Sujet**.
