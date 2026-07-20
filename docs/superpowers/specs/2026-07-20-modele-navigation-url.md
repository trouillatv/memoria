# ADR — Modèle d'URL de la navigation (onglets & fiches)

> Statut : **PROPOSITION, à valider par Vincent.** Aucune ligne de code n'est écrite avant validation.
> Contexte : premier sous-lot du Lot 3. Décidé le 2026-07-20 de figer ce modèle AVANT tout prototype.

## Le problème, mesuré

Ouvrir une fiche prend ~3 s. **Fermer aussi** — alors que fermer ne charge rien. C'est ce second
chiffre qui a démasqué la cause : ce n'est pas le chargement de la fiche, c'est que **toute la page
est recalculée à chaque changement d'adresse**.

Aujourd'hui, l'onglet (`?tab=memoire`) et la fiche (`?decision=…`) sont **deux paramètres de la même
page**. Dans l'App Router, tout changement de paramètre recalcule `page.tsx` entièrement. Les
*layouts*, eux, ne sont pas recalculés — mais ils n'ont pas le droit de lire les paramètres. L'onglet
et la fiche sont donc solidaires par construction : toucher l'un recalcule l'autre.

Un cache a été explicitement **refusé** : il atténuerait le coût en conservant le couplage, et
créerait une dette d'invalidation juste avant de refaire cette architecture.

## Les trois décisions

### 1. L'URL canonique d'un onglet

L'onglet devient un **segment de chemin**, plus un paramètre.

```
/sites/<siteId>                     → Aperçu (défaut)
/sites/<siteId>/travail
/sites/<siteId>/memoire
/sites/<siteId>/memoire/confirmer   → sous-onglet, segment lui aussi
```

Conséquence recherchée : changer de fiche ne touche plus au segment de l'onglet, donc le contenu de
l'onglet n'est plus recalculé.

> ⚠️ **CONTRAINTE DÉCOUVERTE PENDANT LE PROTOTYPE (2026-07-20) — cette forme d'URL
> n'est PAS disponible telle quelle.** L'espace `/sites/<id>/<segment>` est **déjà
> occupé** par une quinzaine de routes héritées : `actions`, `documents`, `reserves`,
> `subjects`, `photos`, `journal`, `preuves`, `visites`, `livraisons`, `obligations`,
> `roulements`, `scopes`, `recit`, `reprise`, `qr`, `chronicle`… et **`memoire`**,
> qui rend aujourd'hui le hub (Atelier / Sujets / Récit) — celui par lequel l'atelier
> reste accessible depuis qu'on a retiré son lien de « À confirmer ».
>
> Le principe (séparer l'onglet de la fiche) n'est pas remis en cause ; **la forme
> des URL l'est.** Le prototype doit proposer une structure compatible avec cet
> héritage — par exemple un préfixe de vue (`/sites/<id>/vue/<onglet>`), ou la
> migration explicite des pages héritées concernées. **À trancher avant de généraliser.**

### 2. L'URL canonique d'une fiche

La fiche devient elle aussi un **segment**, affiché dans une **zone parallèle** (*parallel route*)
interceptée depuis l'onglet.

```
/sites/<siteId>/memoire/decision/<decisionId>
/sites/<siteId>/memoire/action/<actionId>
/sites/<siteId>/memoire/intervenant/<intervenantId>
```

Une seule adresse sert deux rendus, et c'est voulu :

- **naviguée depuis l'application** → interceptée → la fiche s'ouvre **en panneau** par-dessus
  l'onglet, qui reste monté et n'est pas recalculé ;
- **ouverte directement** (lien partagé, favori, rechargement) → non interceptée → la même adresse
  rend une **page complète** de l'objet.

Les paramètres de provenance actuels (`action_source`, `decision_source`, `person_source`,
`from_person`, `action_site`) **disparaissent** : voir ci-dessous.

### 3. « ← », « × », historique et liens profonds

| Geste | Comportement | Effet sur l'historique |
|---|---|---|
| Ouvrir une fiche | `push` vers l'URL de la fiche | **+1 entrée** |
| **←** (remonter d'un cran) | `router.back()` | consomme l'entrée |
| **×** (quitter l'espace) | `push`/`replace` vers l'URL de l'**onglet** | quitte le panneau |
| **Précédent** navigateur | remonte le fil objet par objet | naturel |
| Lien partagé / favori | rend la page complète de l'objet | — |

**Le point le plus important : la provenance n'a plus besoin d'être portée par l'URL.** Aujourd'hui,
`action_source=decision` et `from_person=<id>` existent uniquement parce que l'URL écrase l'objet
précédent et qu'il fallait se souvenir d'où l'on venait. Avec une entrée d'historique par objet, le
« ← » redevient ce qu'il est : **revenir en arrière**. Cela supprime cinq paramètres et la classe de
bugs qui va avec (celle du `from_person` oublié, corrigée cette semaine).

Nuance à trancher au prototype : le « ← » doit-il rester un `router.back()` pur, ou pointer vers une
cible explicite quand il n'y a pas d'historique (arrivée par lien direct) ? Proposition : `back()`
s'il existe une entrée interne, sinon repli vers l'onglet.

## Ce que ça coûte

La migration touche **toute construction d'URL de fiche**, y compris **dans les read models côté
serveur** (`action-fiche.ts`, `decision-fiche.ts`, `causal-threads.ts`, `memory-review.ts`,
`intervenants-dashboard-model.ts`, `actions-dashboard-model.ts`). C'est précisément pour cela que le
modèle doit être figé une seule fois.

Impacts à ne pas découvrir en cours de route : liens internes, partage d'URL, bouton Retour,
favoris, recherche globale (Lot 3), et tout futur objet (Lot 4).

## Risques identifiés

- Les routes parallèles et interceptées sont la réponse prévue par le framework, mais elles ajoutent
  de la structure et ont des comportements subtils (rechargement, historique avec plusieurs zones).
  **C'est exactement ce que le prototype doit éprouver.**
- Le double rendu (panneau / page complète) demande que la fiche soit rendue par **un seul composant**
  monté à deux endroits — sinon on recrée deux vérités, ce que la grammaire des fiches interdit.
- Anciennes URL (`?tab=`, `?decision=`…) : prévoir une redirection, sinon les liens déjà partagés
  cassent.

---

# Résultats du prototype (mesurés en production le 2026-07-20)

> **Prototype VALIDÉ.** Il a confirmé le modèle de navigation et réfuté l'hypothèse
> de performance initiale. C'est son rôle : répondre à une question, pas réussir.

## 1. Le modèle de navigation est validé ✅

Mesuré sur `/sites/<id>/decision/<id>?tab=memoire`, quatre cycles consécutifs :

- **contexte conservé** — défilement à 316 px avant, 316 px après ouverture et fermeture ;
  l'onglet reste actif derrière le panneau ;
- **retour navigateur fiable** — aucun déraillement sur quatre allers-retours ;
  fermeture entre 200 ms et 1 s ;
- **aucun remontage du contenu** — un témoin posé dans le DOM avant ouverture a survécu
  à tous les cycles : le contenu de l'onglet n'est pas reconstruit ;
- **paramètres de provenance disparus** — zéro occurrence de `decision_source` ou
  `from_person` sur la page.

**L'ADR tient.** Le modèle « une adresse canonique par objet + zone parallèle » fonctionne.

## 2. L'hypothèse de performance est réfutée ⚠️

Hypothèse de départ : *découpler les routes ⇒ plus de recalcul ⇒ plus de lenteur.*

Mesure : **l'ouverture reste à 2–3 s** sur les quatre cycles. Le réseau montre que le
navigateur **redemande la route de l'onglet** (~1 à 1,6 s) alors même que son segment
n'a pas changé.

D'où la distinction, qui n'avait pas été anticipée :

> **Ne pas remonter côté client ≠ ne pas recalculer côté serveur.**

Le découplage supprime le remontage. Il ne supprime pas la requête.

## 3. Le double rendu a une limite nommée

L'accès direct plantait (`Cannot destructure property 'store'`) : le corps de la fiche
utilise le titre accessible d'une boîte de dialogue, qui n'existe pas hors d'un panneau.

Conséquence pour la généralisation : **le partage total du composant n'est pas possible.**
Un détail — le titre — dépend nécessairement du contexte d'affichage. D'où `variant:
'panel' | 'page'` : une exception nommée et justifiée, plutôt que deux implémentations
qui divergeraient.

## Décision du Lot 3 — les trois gestes de la navigation entre objets

Le second maillon (chaîne Décision → Action) a tranché : `fermer = history.back()`
ne tient pas. Les deux intentions sont distinctes. Décision de Vincent (2026-07-20) :

| Geste | Sens | Comportement |
|---|---|---|
| **Précédent** du navigateur | explorer le parcours effectué dans le graphe | remonte d'un maillon, panneau ouvert |
| **←** dans la fiche | revenir à l'objet précédent du graphe | remonte d'un maillon, panneau ouvert |
| **×** (et Échap, clic-dehors) | **terminer le parcours courant** dans l'espace des fiches | ferme et revient au contexte (l'onglet) |

Formulation retenue : **« × termine le parcours courant »**, et non « × annule
l'excursion ». La nuance compte : l'historique du navigateur reste un historique de
navigation, on ne cherche pas à le réécrire. Mais choisir *Quitter* exprime une
intention différente de *Revenir en arrière*.

### Invariant d'expérience (à respecter, quelle que soit la technique)

> **Après une fermeture par ×, une pression immédiate sur le bouton Précédent du
> navigateur ne doit pas rouvrir une fiche.**

Ce n'est pas une conséquence technique : c'est une règle d'expérience. La technique
(`replace`, `back`, `history.go(-n)`, autre) sera choisie *pour la respecter* — et
non l'inverse.

⚠️ **État mesuré au 2026-07-20 : cet invariant n'est PAS satisfait.** Le × fait
aujourd'hui un `replace` vers l'onglet ; l'historique passe de
`[onglet] → [décision] → [action]` à `[onglet] → [décision] → [onglet]`, donc
l'entrée « décision » subsiste et un Précédent la rouvre. Les six cas de la recette
sont verts, celui-ci ne l'est pas. Technique à choisir dans un travail dédié.

## Question ouverte (à mesurer, sans désigner de coupable)

> **Pourquoi Next redemande-t-il un payload RSC alors que le segment visible n'a pas
> changé ?**

Causes possibles, aucune établie : `force-dynamic`, `cookies()`, `headers()`,
`searchParams`, `fetch(..., { cache: 'no-store' })`, invalidation RSC, ou simplement le
comportement normal du routeur. **Ne pas partir en chasse d'un coupable avant d'avoir la
preuve** — la première tentative d'explication (`force-dynamic`) était une hypothèse
présentée comme une cause, exactement l'erreur que ce projet s'interdit.

## Périmètre du prototype (après validation de cet ADR)

**Un seul onglet, un seul type de fiche** : `memoire` + `decision`.

Mesures à produire **avant / après**, sur la production :

1. ouverture d'une fiche ;
2. fermeture ;
3. retour navigateur ;
4. conservation du contexte (onglet, sous-onglet, défilement) ;
5. **preuve que le contenu de l'onglet n'est plus recalculé** — c'est le critère qui décide.

Si le prototype ne supprime pas le recalcul, on ne généralise pas : on revient ici.
