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

## Périmètre du prototype (après validation de cet ADR)

**Un seul onglet, un seul type de fiche** : `memoire` + `decision`.

Mesures à produire **avant / après**, sur la production :

1. ouverture d'une fiche ;
2. fermeture ;
3. retour navigateur ;
4. conservation du contexte (onglet, sous-onglet, défilement) ;
5. **preuve que le contenu de l'onglet n'est plus recalculé** — c'est le critère qui décide.

Si le prototype ne supprime pas le recalcul, on ne généralise pas : on revient ici.
