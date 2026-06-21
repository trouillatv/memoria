# Observation terrain — Comment Guillaume pense avec les sujets

**On ne teste plus une feature. On observe un usage.** Le cycle 1 du Sujet est
terminé (historique → compréhension → impact). L'architecture est cohérente. Avant
de construire quoi que ce soit d'autre, le terrain vaut plus qu'un sprint.

**On ne montre pas la roadmap. On ne souffle aucune réponse.** Ce qu'on cherche,
c'est comment Guillaume raisonne **spontanément** — pas s'il sait utiliser l'outil.

---

## Test 1 — L'usage réel (observer, se taire)

Consigne unique, sans rien expliquer :

> **« Montre-moi les 5 sujets qui te préoccupent le plus en ce moment. »**

Puis on **observe**, sans guider (un observateur note, ne commente pas) :

- Ouvre-t-il **la page Sujet** ? ou retourne-t-il aux CR / à sa mémoire ?
- Lit-il **l'état / la cause** ? s'y fie-t-il, ou les ignore-t-il ?
- Regarde-t-il les **dépendances** (« ça bloque quoi ») ? les renseigne-t-il ?
- Passe-t-il par le **briefing** avant une réunion ?

> Le silence et les détours sont des données. S'il rouvre un CR au lieu de lire le
> bloc État, c'est que le bloc ne suffit pas — on note **pourquoi**.

---

## Test 2 — Le manque (la question ouverte)

La plus importante. Sans montrer la roadmap :

> **« Qu'est-ce qui te manque encore ? »**

On écoute la **première** réponse spontanée, et on la range :

| S'il dit spontanément… | …alors la prochaine brique est |
|---|---|
| « je voudrais voir **tous les DOE** » / sur tous les chantiers | **P4 — recherche transverse** |
| « pourquoi les sujets **reviennent** toujours » | **Détecteur de récurrence** (≠ un simple compteur) |
| « savoir ce qui **va déraper** » | **Anticipation** (signaux faibles) |

On ne décide pas à sa place. On laisse la **fréquence** des réponses (sur 2-3
personnes, plusieurs jours) désigner la priorité.

---

## Hypothèse de travail (à confirmer, pas à coder)

Intuition Vincent : la prochaine grosse brique n'est peut-être pas la recherche,
mais le **sujet récurrent**. On sait déjà *pourquoi c'est ouvert* et *ce que ça
bloque* ; on ne sait pas encore **pourquoi ça revient sans cesse** — et ça, un
humain ne le voit pas naturellement.

⚠ Nuance à garder en tête quand le moment viendra : « récurrent » n'est PAS un
compteur de réunions (ça existe déjà). C'est *« ce sujet réapparaît parce que la
même cause n'est jamais traitée »*. La vraie valeur est la **cause de la
récurrence**, pas le nombre d'apparitions.

---

## La discipline à tenir longtemps (anti-usine-à-gaz)

- **Un seul verbe : BLOQUE.** Pas de `lié`, `dépend`, `impacte`, `conditionne`…
- Avant d'ajouter le moindre verbe / champ / détecteur, **une seule question** :
  > « Quelle **décision** vas-tu prendre grâce à cette information ? »
  Si personne ne sait répondre → **on ne le construit pas.**
- Pas de graphe, pas de Gantt, pas de chemin critique, pas d'analyse auto.

Cf. [[lien-utile-aide-a-agir]] · [[discipline-dapparition]] · [[gouvernance-4-concepts-anti-erp]].
