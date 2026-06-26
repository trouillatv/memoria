# Visites terrain — 10 scénarios d'usage

> **Compagnon fonctionnel** du cadrage technique
> [`2026-06-26-visites-terrain-session-orientee-objectif.md`](../specs/2026-06-26-visites-terrain-session-orientee-objectif.md).
> Écrit pour Guillaume (conducteur de travaux / MOE BECIB) et Émeline — **sans jargon**.
> Objectif : vérifier que la brique « tient » au contact de la vraie journée, et faire
> remonter les derniers détails ergonomiques. **La spec n'est figée qu'après le passage de
> ces scénarios.**

> **À garder en tête à chaque scénario** : *une visite ne sert pas à produire un document.
> Elle sert à faire progresser la mémoire du chantier. Le document n'est qu'une conséquence
> éventuelle.* Plusieurs scénarios ci-dessous ne produisent **aucun** document — et c'est
> normal.

Chaque visite suit le même rythme : **pourquoi je viens → ce que MemorIA me rappelle → ce
que je fais → comment je referme**. Seul le motif change ce qui s'affiche.

---

## 1. Visite spontanée — « je passais devant »

Guillaume finit un rendez-vous à 11 h. Le chantier Médipôle est à 400 m. Il a 20 minutes.

- Il ouvre MemorIA → **▶ Démarrer une visite**.
- *Pourquoi venez-vous ?* → **Contrôle**. *Objectif ?* → « voir où en est le terrassement zone nord ».
- MemorIA affiche aussitôt, **avant** la moindre photo :
  > Médipôle — Contrôle · 2 réserves ouvertes · 3 actions en retard · journal photo inactif depuis 12 j
- Il prend 4 photos, dicte un vocal de 30 s, crée une action « relancer ETV sur l'évacuation des terres ».
- **Clôture** : Résultat → *Conforme avec réserves*. Suite → *Rien* (il n'a pas le temps de faire un CR).
- La trace reste : datée, située, interrogeable. Dans six mois, « qu'a-t-on vu le 26/06 zone nord ? » a une réponse.

**Ce que ça prouve** : on capture une visite non planifiée en moins d'une minute, sans rien produire d'obligatoire.

---

## 2. Visite de contrôle ciblée — « je viens voir les enrobés »

- **▶ Démarrer une visite** → motif **Contrôle** → *Que venez-vous voir ?* → **Sujet : Enrobés**.
- Le briefing devient **ciblé** sur ce sujet :
  > Enrobés — 3 décisions · 2 actions · 1 réserve · 4 photos · 1 obligation
  > ⚠ température de pose jamais relevée
- Guillaume sait quoi regarder *avant* de descendre de voiture. Il relève la température, la note, photographie.
- **Clôture** : Résultat → *À revoir*. **Résolution** → *Recontrôle nécessaire*.
- MemorIA propose alors : *Programmer une nouvelle visite ?* — déjà pré-remplie sur le sujet Enrobés. Guillaume met mardi.

**Ce que ça prouve** : l'objectif organise la mémoire ; la résolution « recontrôle » referme la boucle en proposant la prochaine visite.

---

## 3. Visite de réception — « on réceptionne le lot VRD »

Réception = on a besoin de **preuve**, pas seulement de mémoire. Le motif route vers le rail intervention.

- **▶ Démarrer une visite** → motif **Réception**.
- Briefing spécifique : DOE, plans de récolement, contrôles attendus, réserves finales restantes.
- Guillaume coche les contrôles, photographie, liste 2 réserves finales.
- **Clôture** : génère un **PV de réception** + une preuve **signée** (rail intervention). Résultat → *Conforme avec réserves*.

**Ce que ça prouve** : le même bouton « Démarrer une visite » mène, selon le motif, à une sortie *preuve* — sans écran séparé.

---

## 4. Visite de levée de réserves — photo avant / après signée

- **▶ Démarrer une visite** → motif **Levée de réserves**.
- Briefing : **uniquement** les réserves ouvertes du site, avec leur photo « avant ».
- Sur place : pour chaque réserve traitée, photo « après », puis levée.
- **Clôture** : preuve signée (rail intervention). Les réserves levées passent en « levée », datées et tracées.

**Ce que ça prouve** : un motif peut restreindre radicalement le briefing (rien d'autre que les réserves) et produire une preuve opposable.

---

## 5. Visite d'expertise / constat — « il y a une fuite »

- **▶ Démarrer une visite** → motif **Constat / Expertise** → *Objectif* → « constater l'infiltration sous-sol ».
- Briefing : historique du sujet (s'il existe), photos datées antérieures.
- Guillaume documente : photos, vocal descriptif, localisation. Aucune action immédiate possible.
- **Clôture** : sortie *Fiche constat*. Résultat → *Non conforme*. **Résolution** → *À suivre* (il attend un avis).
- Le sujet « Infiltration sous-sol » reste **ouvert**. Pas de visite forcée, mais il remontera au prochain briefing du site.

**Ce que ça prouve** : une visite peut ne produire qu'un constat, sans conclure — la résolution « à suivre » garde le sujet vivant sans imposer de suite.

---

## 6. Visite libre — Émeline fait un tour rapide

- **▶ Démarrer une visite** → motif **Visite libre**. Pas d'objectif précis, pas de cible.
- Briefing : version condensée du climat du site (sujets chauds, derniers signaux).
- Elle prend quelques photos d'avancement, dicte deux remarques.
- **Clôture** : comme il n'y avait **pas** d'objectif/cible, MemorIA **ne demande pas** de résolution (on ne crée pas de friction). Résultat → *Information uniquement*. Suite → *Ajouter au journal du chantier*.

**Ce que ça prouve** : la discipline d'apparition — pas d'objectif ⇒ pas de question de résolution. L'outil ne fait pas remplir des cases inutiles.

---

## 7. Visite déclenchée par QR — devant un ouvrage

Un QR est collé sur la porte coupe-feu RF-203 (ou le regard EP-17).

- Guillaume scanne → MemorIA ouvre directement une visite **avec la cible déjà remplie** (l'ouvrage scanné).
  > Porte RF-203 — 1 obligation (PV essai) · dernière vérif 14/05 · 0 réserve
- Il vérifie, photographie, note. **Clôture** en deux taps.

**Ce que ça prouve** : le QR n'est qu'une **origine** + une **cible pré-remplie** — exactement la même visite, entrée par une autre porte. (Cran 2.)

---

## 8. Visite géolocalisée — « vous êtes à 80 m de Médipôle »

- Guillaume arrive sur site, ouvre MemorIA. Sans rien chercher :
  > Vous êtes à moins de 150 m de **Médipôle**. Démarrer une visite ici ?
- Un tap → la visite démarre avec le bon chantier pré-sélectionné. Il choisit juste le motif.
- La position sert **uniquement** à proposer le bon site à l'ouverture. Elle n'est **jamais** re-suivie, ni transformée en durée de présence.

**Ce que ça prouve** : le GPS est un **accélérateur d'entrée** opt-in, pas un mouchard. (Cran 2 ; frontière anti-pointage tenue.)

---

## 9. Visite par un intervenant externe — sous-traitant sans compte

L'ETV envoie son chef d'équipe relever un point. Il n'a pas de compte MemorIA.

- Guillaume lui transmet un **lien de visite** (token), borné en permissions.
- Le sous-traitant ouvre le lien sur son téléphone : il peut **photographier**, **cocher**, dire **« terminé »**.
- Il **ne peut pas** créer une décision, lever une réserve à la place du MOE, ni clôturer le chantier — ces actions sont refusées côté serveur, pas seulement masquées.

**Ce que ça prouve** : on n'empêche jamais quelqu'un de *démarrer* une session ; on borne ce qu'il peut *produire* pendant. (Cran 2.)

---

## 10. Visite qui devient un PV — réunion de chantier

La réunion hebdo est aussi une visite (motif **Réunion**).

- **▶ Démarrer une visite** → motif **Réunion**.
- Briefing : participants attendus, ordre du jour, décisions et actions ouvertes du dernier CR, points à confirmer.
- Pendant : captation (vocal + notes), création de décisions/actions au fil de l'eau.
- **Clôture** : sortie **PV** → reprend tout le pipeline existant (validation Émeline, template BECIB, questions « à confirmer avant PV »).

**Ce que ça prouve** : la « réunion » d'aujourd'hui **est** déjà une visite — on n'a rien dupliqué, on a juste donné un nom commun à l'événement.

---

## Synthèse — ce que les 10 scénarios valident

| # | Motif | Origine | Moteur | Produit | Point clé |
|---|---|---|---|---|---|
| 1 | Contrôle | spontanée | report | rien | capture < 1 min, zéro doc obligatoire |
| 2 | Contrôle | spontanée | report | action + prochaine visite | objectif → mémoire ; résolution → boucle |
| 3 | Réception | planifiée | **intervention** | PV + preuve signée | même bouton, sortie preuve |
| 4 | Levée réserves | planifiée | **intervention** | preuve signée | briefing ultra-restreint |
| 5 | Constat | spontanée | report | fiche constat | conclure n'est pas obligatoire |
| 6 | Visite libre | spontanée | report | journal | pas d'objectif ⇒ pas de résolution |
| 7 | (selon ouvrage) | **QR** | report | variable | cible pré-remplie |
| 8 | (au choix) | **GPS** | report | variable | accélérateur opt-in, jamais mouchard |
| 9 | (selon mission) | token | selon motif | photos / coches | permissions bornées serveur |
| 10 | Réunion | planifiée | report | **PV** | la réunion est déjà une visite |

**Invariants vérifiés sur les 10** : aucun résultat ne qualifie une *personne* ; la gravité
n'est jamais *demandée* (dérivée des objets produits) ; le PV n'est jamais *imposé* ; le GPS
ne sert qu'à proposer le bon site à l'ouverture.

---

## Questions ouvertes que ces scénarios font remonter (à trancher avant dev)

1. **Scénario 2 vs 5** — quand une visite a plusieurs cibles (« je viens voir les enrobés *et* la fuite »), une visite = une cible, ou plusieurs ? *(proposition : une cible principale + cibles secondaires en tags, à confirmer)*
2. **Scénario 6** — sans objectif, garde-t-on quand même l'`outcome` ? *(proposition : oui, optionnel ; c'est la résolution seule qu'on masque)*
3. **Scénario 9** — un externe peut-il déclencher une visite **de lui-même** (lien permanent), ou seulement via un lien envoyé par le MOE pour une visite précise ? *(impacte la frontière « inversion de charge » vs contrôle BECIB)*
4. **Scénario 10** — bascule-t-on l'écran Réunion actuel vers ce flux dès le MVP, ou les visites « terrain » d'abord et la réunion rejoint plus tard ?
