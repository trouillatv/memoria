# Cadrage — Le graphe Acteurs comme EXPLORATEUR D'ÉCOSYSTÈME (V3 UX)

Statut : **cadrage, sans code.** Décisions en fin de document.
Date : 2026-07-28.

## 1. Intention

Passer d'un graphe qui **montre les données** à un explorateur qui **révèle
l'information progressivement et RACONTE une histoire**. Le moteur (étapes 2→5)
calcule déjà : interactions datées, force de relation récencée, tendance, top
relations, écosystème. L'interface n'en montre encore qu'une fraction.

Principe directeur : **une lecture = une question = un graphe** ; la **couleur** ne
code que l'organisation ; la **forme** code le type ; les **liens** portent
l'intensité et l'ancienneté ; l'**inspecteur** raconte.

## 2. Point d'architecture DÉCISIF : deux sources de graphe

Le point #1 de Vincent — « changer de lecture, ce n'est pas un filtre, c'est un
AUTRE graphe » — implique deux sources distinctes :

- **Graphe STRUCTUREL** (actuel) : nœuds acteurs + chantiers + actions, arêtes =
  relations FK (`belongs_to`, `member_of`, `intervenes_on`…). Sert les lectures
  **Organigramme / Chantiers / Travail / Réseau** — simple filtrage par couches
  (déjà en place).
- **Graphe des RELATIONS AGRÉGÉES** (nouveau) : nœuds = acteurs, arêtes = relations
  de l'**étape 5** (force, tendance, récence). Sert la lecture **Collaboration** —
  épaisseur = force, transparence = ancienneté. C'est bien « un autre graphe ».

→ La barre de lecture **bascule entre ces deux sources**. C'est la clé du lot.

## 3. Confrontation des 8 axes au réel

| Axe Vincent | État | Ce qu'il faut |
|---|---|---|
| 1. Barre de lecture = graphes distincts | Perspectives faites (structurel) ; « Collaboration » manque | Ajouter la source « relations agrégées » |
| 2. Règles par lecture | ~faites (couches) ; Collaboration nouvelle | Construire le graphe pondéré |
| 3. Formes = type | ❌ (ronds + taille) | Pictogrammes canvas (👤🏢👥📍✔) |
| 4. Couleur = orga (fond) + halo attention | ✅ (fait au lot UX précédent) | Rien — verrouiller la doctrine |
| 5. Liens : couleur=nature / épaisseur=intensité / transparence=ancienneté | couleur=optionnelle ✅ ; intensité+ancienneté = seulement sur le graphe des relations | Rendu pondéré sur la lecture Collaboration |
| 6. Filtres = idées | partiel | fortes(relatif)/récentes/alertes/historiques/internes-externes OK ; **sous-traitant = pas de donnée** |
| 7. Inspecteur qui RACONTE | ❌ (fiche) | Synthèse narrative depuis étapes 3-5 |
| 8. Interactions manuelles | ❌ | **Nouveau modèle + retour de doctrine** (§5) |

## 4. Buildable MAINTENANT (zéro donnée nouvelle)

- **Formes = type** + couleur = orga/halo (rendu pur).
- **Lecture Collaboration** : graphe pondéré depuis l'étape 5 (épaisseur = force,
  transparence = récence/tendance) — « en 1 s, cette entreprise travaille énormément
  avec celle-là ».
- **Inspecteur narratif** : « X chantiers communs · Y actions · collaboration
  [stable / en hausse] · principal interlocuteur Z · active depuis … » — TOUT sauf
  les visites (voir §5). Dérivé des étapes 3-5, aucune donnée nouvelle.
- **Filtres-idées** : Relations fortes (critère RELATIF, cf. D2), récentes
  (tendance), alertes (attention), historiques (inactive), internes/externes
  (`is_internal_agent`).

## 5. BLOQUÉ / nouveau (à ne pas fabriquer)

- **« 26 visites » / co-présence réunion-CR fiable** → étape 6 (liaison structurelle
  report↔acteur). Sans elle, l'inspecteur ne racontera pas les visites.
- **« Sous-traitant »** → aucune donnée structurelle. Dépend d'un champ dédié ou des
  relations déclarées (§ suivant).
- **Interactions manuelles (#8)** — glisser une personne d'une entreprise à l'autre,
  créer un lien « travaille souvent avec » / « sous-traitant habituel », groupes :
  **RÉINTRODUISENT des relations DÉCLARÉES**, que la doctrine V2 excluait
  explicitement (« une mention n'est pas une identité ; seul le structurel »).
  C'est légitime, mais c'est un **nouveau modèle persistant** :
  - table `manual_actor_relations` (paire, type déclaré, provenance « déclaré par X
    le … », note) ;
  - **distinction visuelle stricte** déclaré (ex. trait pointillé) vs structurel ;
  - édition de `company_contacts.company_id` pour le glisser (mutation sensible →
    audit) ;
  - jamais mélangé avec la force calculée (le déclaré ne fabrique pas de score).
  → **Lot dédié, plus tard.**

## 6. Séquence proposée (révélation progressive, valeur ↑ / risque ↑)

1. **Inspecteur NARRATIF** — raconte la relation/l'acteur depuis les étapes 3-5.
   Plus forte valeur différenciante (« n'existe dans aucun logiciel BTP »), zéro
   donnée nouvelle. *(reco pour commencer)*
2. **Lecture COLLABORATION** — graphe des relations agrégées, épaisseur = force,
   transparence = ancienneté. Le « wahou » visuel ; branche l'étape 5.
3. **Formes = type** + **filtres-idées** disponibles.
4. *(parallèle data)* **étape 6** report↔acteur → visites fiables + breakdown
   multi-signal.
5. *(lot sensible, plus tard)* **interactions manuelles + relations déclarées**
   (nouveau modèle + doctrine + audit).

## 7. Décisions

- **D1 — Dualité de sources :** valider que « Collaboration » est un graphe DISTINCT
  (relations agrégées de l'étape 5), pas le graphe structurel filtré. *(reco : oui)*
- **D2 — « Relations fortes » :** critère RELATIF (top N / au-dessus de la médiane de
  l'acteur), PAS de seuil absolu tant que les distributions ne sont pas observées.
- **D3 — Relations déclarées (#8) :** acter qu'elles réintroduisent du « déclaré »
  (exclu jusqu'ici), avec distinction stricte déclaré/structurel et provenance ;
  lot dédié. « Sous-traitant » en dépend.
- **D4 — Par quoi commencer :** reco = **inspecteur narratif** (raconte, 0 donnée
  nouvelle), puis lecture Collaboration.
