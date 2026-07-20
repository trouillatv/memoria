# Maquette fonctionnelle — la porte d'entrée dans le graphe

> Statut : **VALIDÉ par Vincent (2026-07-20), les deux marches sont livrées et
> vérifiées en production** — voir « Ce qui a été livré » en fin de document.
> Cadrage (Vincent, 2026-07-20) : *« Le premier objectif n'est pas de construire une
> recherche. C'est de construire une nouvelle porte d'entrée dans le graphe de
> connaissances. »*
>
> Maquette **fonctionnelle**, pas graphique : elle fige un comportement, pas une image.

## Le constat qui change le travail

**La porte existe déjà et elle est en production.** `components/layout/SearchOverlay.tsx` :
bouton dans la barre du haut, raccourci ⌘K / Ctrl+K, résultats groupés par type sur
16 types, recherche au fil de l'eau (250 ms), état vide rédigé, Échap ferme. Aucun LLM :
la RPC `search_memory` (migration 044), du retrieval pur. Une page `/recherche` existe
également, avec des filtres.

Ce qui ne marche pas est d'une ligne — `lib/db/memory-search.ts:116` :

```
// Sinon la fiche chantier, qui agrège la mémoire (pas de deep-link par objet).
return `/sites/${hit.siteId}`
```

On cherche « réception », on trouve une Décision, on clique… et on arrive sur **l'accueil
du chantier**. L'objet trouvé est perdu au moment exact où on l'ouvre.

Le commentaire dit pourquoi : *« pas de deep-link par objet »*. **Cette phrase était vraie
hier et ne l'est plus** : Décision et Action ont désormais une adresse canonique qui ouvre
dans la coquille de fiches persistante (ADR navigation, validé le 2026-07-20).

> La porte n'est pas à construire. **Elle donne sur le couloir au lieu de la pièce.**

## Le parcours figé — réponses aux six questions

| Question | Réponse | État |
|---|---|---|
| **Où ouvre-t-on la recherche ?** | Overlay ⌘K depuis n'importe quelle page, + bouton dans la barre du haut. Pas de nouvelle surface. | **existe** |
| **Voit-on les résultats au fil de l'eau ?** | Oui, dès 2 caractères, avec 250 ms d'attente pour ne pas requêter à chaque frappe. | **existe** |
| **Groupés ou mélangés ?** | **Groupés par type**, avec le compte par groupe. Le type est l'information qui oriente : on cherche rarement « quelque chose », on cherche une décision ou une action. | **existe** |
| **Comment passe-t-on à la fiche ?** | Un clic ouvre l'objet **dans la coquille de fiches persistante**, à son adresse canonique. | **À FAIRE — c'est tout le lot** |
| **Échap / Entrée / flèches ?** | Échap ferme (existe). **Entrée ouvre le premier résultat, ↑↓ parcourent la liste** — absents aujourd'hui, la souris est obligatoire. | **partiel** |
| **Aucun résultat ?** | « Aucun résultat pour « X ». » (existe). À revoir seulement si l'usage montre que c'est un mur. | **existe** |

## La première marche

Une seule chose, la plus petite qui produise un comportement visible :

**`memoryHitHref()` rend l'adresse de l'objet quand elle existe.**

- `site_decision` → `/sites/<siteId>/decision/<id>` → s'ouvre en panneau ;
- `site_action` → `/sites/<siteId>/action/<id>` → s'ouvre en panneau ;
- tout le reste → **inchangé**, y compris la règle « on emmène vers le fil s'il existe »
  qui reste juste pour les faits rattachés à un sujet.

Puis le clavier (Entrée, ↑↓), qui transforme la recherche en outil de navigation plutôt
qu'en formulaire.

Contraintes retenues : **retrieval uniquement, aucun LLM**, réutilisation du moteur typé
existant, ouverture dans la coquille déjà validée. Aucune nouvelle surface, aucun nouveau
vocabulaire à apprendre.

## Ce qui est explicitement PARQUÉ

**Le hub par sujet.** Regrouper des objets autour d'un thème suppose de définir ce qu'est
un « sujet » — mot-clé ? groupe sémantique ? dossier implicite ? ensemble de décisions
liées ? C'est une notion **métier**, pas technique. La trancher maintenant rouvrirait un
chantier de modélisation juste après avoir stabilisé la navigation.

Elle reviendra **si l'usage la réclame**, pas parce que la cible initiale la mentionnait.

## Coût connu d'avance

Mesuré le 2026-07-20 : un aller-retour vers la base coûte **~185 ms quoi qu'il lise**, et
N allers-retours **simultanés** coûtent le prix d'un seul.

> **Invariant mesurable** (formulation de Vincent) : *une recherche utilisateur déclenche
> une seule opération de retrieval, quel que soit le nombre de types affichés.*

Tenu aujourd'hui : la RPC `search_memory` fait une passe et rend tous les types.

---

## Ce qui a été livré (2026-07-20)

**Deux commits séparés**, pour que la validation des deep-links ne soit pas brouillée par
l'ergonomie de la palette.

### 1. Les résultats ouvrent l'objet trouvé (`a72adc5a`)

Découverte en cours de route : **deux portes existaient avec deux règles.** `/recherche`
passait par `memoryHitHref()`, l'overlay ⌘K avait la sienne et renvoyait toujours au
chantier. Corriger la fonction seule n'aurait ouvert qu'une porte sur deux ; elles
partagent désormais la même règle.

La règle vit maintenant dans `lib/memory/hit-href.ts`, module **pur** : `memory-search.ts`
importe le client admin (clé service role) et n'a rien à faire dans un bundle client, or
l'overlay est un composant client.

Vérifié en production : depuis `/recherche`, la Décision s'ouvre en **page complète** (route
non interceptée) ; depuis une page du chantier, la même adresse s'ouvre **en panneau**,
contexte conservé. Les autres types gardent leur repli vers le chantier.

### 2. La palette se pilote au clavier (`623a9c76`)

↑↓ déplacent la sélection **dans l'ordre affiché** — les résultats sont groupés par type,
donc l'ordre à l'écran n'est pas celui de la pertinence : le clavier suit les yeux. Entrée
ouvre le résultat visé, ou le premier à défaut. Échap fermait déjà.

Le focus reste **dans le champ** : on continue de taper pendant qu'on parcourt. D'où
`aria-activedescendant` sur un `role="combobox"` plutôt qu'un focus déplacé — un lecteur
d'écran annonce le résultat visé sans que la saisie perde le focus.

Vérifié en production : ⌘K → saisie → ↓ → Entrée → le panneau de la Décision s'ouvre et
l'overlay se ferme.
