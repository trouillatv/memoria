# Cadrage — Chaque lecture a son propre algorithme de placement (V3 UX, Phase 1)

Statut : **cadrage** (un micro-ajustement de tailles est livré à part).
Date : 2026-07-28.

## 1. L'insight (Vincent)

Aujourd'hui on change **ce qu'on affiche** (filtrage par couches), pas **comment le
graphe est construit**. Les cinq lectures utilisent le **même moteur
force-directed** → tout se ressemble, tout « flotte ». Le saut d'un graphe de
données à un outil d'analyse métier : **chaque lecture a son LAYOUT**.

> « Un bon graphe métier doit raconter quelque chose AVANT même qu'on lise. »

## 2. Les cinq layouts cibles

| Lecture | Layout | Idée |
|---|---|---|
| **Organigramme** | HIÉRARCHIQUE, déterministe, **sans physique** | entreprise en tête, ses personnes dessous, groupées — « un vrai organigramme » |
| **Chantiers** | RADIAL centré sur les **chantiers (hubs)** | chantier au centre, entreprises autour, personnes en périphérie |
| **Collaboration** | réseau pondéré **ENTREPRISES SEULES** (type Gephi) | très peu de nœuds, gros/petits liens ; double-clic = ouvrir les personnes |
| **Écosystème** | **grappes** (clusters) par entreprise | clic sur une entreprise = déployer ses employés |
| **Travail** | centré sur les **responsables + leurs actions** | seul endroit où les actions apparaissent |

## 3. Refinements transverses

- **Entreprise dominante** (~2:1 vs personne) — l'entreprise est l'ancre, la personne
  secondaire. *(livré, cf. §6)*
- **Chantiers = HUBS** : identité très différente (ce sont eux qui créent les
  collaborations). *(taille livrée ; forme distincte = lot « formes = type »)*
- **Actions uniquement dans Travail** — une action est une conséquence, pas une
  relation. *(déjà le cas : Organigramme/Chantiers les excluent ; seul Réseau montre
  tout)*
- **Moins de couleur, plus de SPATIAL** : le regroupement, la proximité, l'encadrement
  portent le sens ; la couleur (fond = entreprise) redevient secondaire. Les layouts
  hiérarchique/clusters rendent la couleur moins nécessaire à la lecture.

## 4. Architecture (le vrai changement)

Le moteur partagé ne fait que du force-directed. Il faut deux familles :

- **Layouts DÉTERMINISTES** (Organigramme, Chantiers) : positions **calculées**,
  physique **désactivée** (nœuds épinglés). → ajouter au canvas un mode
  « layout statique » : `layout(nodes, size) → positions` + `physics: off`.
- **Layouts PHYSIQUES** (Collaboration réseau, Écosystème clusters) : garder le
  moteur, le **paramétrer** — force → proximité (déjà là) ; clusters = gravité par
  groupe d'entreprise.
- **Travail** : hybride (centré responsables + actions en satellites).

C'est un ajout ciblé au canvas (option de layout), pas une réécriture du moteur.

## 5. Plan (= priorité Vincent)

**Phase 1 — un layout par lecture** *(ce cadrage)* :
1. **Organigramme hiérarchique** — plus fort gain de clarté, le plus attendu.
2. **Chantiers radial** (chantiers = hubs).
3. **Collaboration** entreprises seules + double-clic.
4. **Écosystème** clusters par entreprise.
5. **Travail** centré responsables.

**Phase 2** — inspecteur narratif, dernières interactions, intensité, CR/visites.
**Phase 3** — relations manuelles, glisser-déposer, organigramme éditable.

## 6. Livré avec ce cadrage

**Dominance visuelle** (refinement #8/#9, sans nouveau layout) : entreprise nettement
plus grosse que la personne, chantier agrandi en « hub ». Structurel : entreprise 30 ·
chantier 26 (hub) · équipe 15 · personne 13 · action 8. Collaboration : entreprise 32 ·
personne 15. (~2:1 entreprise/personne.)

## 7. Décisions

- **D1** — Introduire un mode **« layout statique »** dans le canvas (positions
  déterministes + physique off) pour Organigramme/Chantiers. *(reco : oui)*
- **D2** — **Collaboration devient entreprises seules** (double-clic = personnes) ;
  elle se distingue d'Écosystème par le **layout** (réseau pondéré vs clusters). À
  acter : convergence temporaire des deux tant que les deux layouts n'existent pas.
- **D3** — Par quoi commencer. *(reco : Organigramme hiérarchique — le « avant/après »
  le plus parlant, et il prouve le principe « un layout par lecture ».)*
