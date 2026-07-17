# Lot 1 — Planifier une intervention sans friction

**Décision : LOT 1 FERMÉ** — 2026-07-18.

## Objectif

Passer de « je dois envoyer quelqu'un demain sur ce chantier » à « l'intervention
est planifiée » sans quitter le planificateur, même quand mission, équipe ou
personne manquent.

## Ce que l'audit a établi (avant tout code)

- Mission et équipe se créaient DÉJÀ inline (PR #123, #189) avec retour et
  sélection automatiques — à ne pas reconstruire.
- Le seul maillon brisé : **la personne**. L'équipe créée inline naissait vide,
  et ajouter quelqu'un exigeait de quitter vers `/intervenants`… qui crée un
  **compte Auth**. Trois notions étaient mélangées (utilisateur / personne de
  planification / intervenant de la mémoire).

## Livré (commit `1603ff5f`, migration 219)

- `company_contacts` = socle canonique des personnes terrain : entreprise
  **optionnelle**, `organization_id` porté par le contact (NOT NULL, RLS directe).
- `team_field_members` = appartenance des personnes terrain aux équipes.
  `team_members` reste réservé aux utilisateurs connectés — ses 33 lecteurs
  (briefings, passation, continuité) supposent un compte, à raison.
- Garanties par **triggers** (valables sous service-role) : jamais deux tenants
  liés, contact archivé refusé, pas de doublon actif (unicité partielle
  `WHERE left_at IS NULL`), historique conservé (quitter/revenir, archivages non
  destructifs). Prouvées 9/9 sur la base réelle.
- Dialogue du planificateur : « + Ajouter une personne » dès qu'une équipe est
  sélectionnée, **auto-ouvert** après création d'équipe inline ; nom + métier
  optionnel + entreprise optionnelle ; compteur à jour ; modal jamais fermé.
- Composition (page Équipes, fiche équipe) : « Membres connectés » vs
  « Personnes terrain » (badge Terrain) ; compteur global additionne.
- Interdits respectés : aucun compte, aucune invitation, aucun rôle applicatif,
  aucune affectation individuelle d'intervention, rien du Lot Intervenants —
  et rien qui l'empêche (fusion/liaison futures possibles, ids stables).

## Preuves

- **Base réelle** : 9/9 garanties triggers vérifiées puis nettoyées ; recette
  complète sur le tenant Démo (session par lien magique, compte `demo@memoria.nc`).
- **Cascade utilisateur observée au navigateur (prod, tenant Démo)** :
  Planifier → mission 🧪 créée+sélectionnée → équipe 🧪 créée+sélectionnée →
  bloc personne auto-ouvert → « M. X — Électricien » sans entreprise →
  « 🧪 Recette lot 1 · 1 personne » sans fermeture du modal → intervention
  18/07 8h–10h → **apparue dans la grille, persistante au rechargement** ;
  page Équipes : « M. X — Électricien ‹TERRAIN› ». Tenant Démo remis à son état
  initial ensuite.
- **Tests** : 6 unitaires (fail-closed org, org du serveur, geste entreprise
  canonique, rollback anti-orphelin) vérifiés en cassant le code (3 tombent) ;
  suite complète 1361 verts ; typecheck, lint.

## Reliquat traité dans la foulée

Deux écrans s'appelaient « Planning » — dont un sans bouton Planifier. Corrigé :
`/planning` s'intitule désormais **« Journal des interventions »** (aligné sur
son nom de nav), les navs mobiles disent « Journal », et son en-tête offre
« Planifier — ouvrir le planning » vers `/semaine`.

## Méthode (décision du 2026-07-18, pendant ce lot)

Recette à trois niveaux : petit maillon = Claude code + tests, **Vincent teste
en 2 min** ; Claude-in-Chrome réservé aux cas invérifiables à la main (cache,
drag & drop, offline…) et aux releases. La recette navigateur de ce lot a coûté
~1 h pour ce que Vincent valide en 2 min — c'est elle qui a motivé la décision.

## Limites connues

- `intervention_participants` reste réservé aux comptes (l'intervention
  s'affecte à l'équipe — doctrine mig 023 inchangée).
- Pas d'UI de retrait d'une personne terrain (`left_at`) — viendra avec la
  gestion d'équipe.
- Étape « mobile » du cadrage initial non traitée (hors périmètre validé).
