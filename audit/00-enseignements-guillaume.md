# 00 — Enseignements de la session Guillaume (2026-07-13)

> Lecture produit de Vincent, document de référence. À lire AVANT les audits
> techniques : il distingue les **bugs** (à corriger, ne changent pas la
> conception) des **frictions métier** (le modèle mental de l'app ne correspond
> plus au sien — c'est là que se joue la conception).

## Les deux enseignements majeurs

### 1. MemorIA est encore « orienté événement »

Modèle actuel : je crée quelque chose → je le réalise → je le clôture.
Réalité d'un responsable d'exploitation : **le monde est déjà en place** —

```
Sites → Équipes → Planning permanent → Exceptions → Visites → Preuves
```

Les événements viennent PERTURBER un monde qui tourne ; l'application demande
aujourd'hui de reconstruire le chantier à chaque fois.

### 2. Guillaume ne cherche pas un outil de planification

Il a déjà son planning. Il cherche un **assistant opérationnel** qui réponde à :
qui intervient aujourd'hui ? qu'est-ce qui devait être fait ? qu'est-ce qui a
réellement été fait ? quelles preuves ai-je ? que dois-je vérifier ? qu'est-ce
qui change cette semaine ?

> La valeur de MemorIA n'est pas de remplacer Excel ou un logiciel RH, mais de
> **transformer un planning existant en mémoire opérationnelle vivante.**

## Les 12 frictions, triées

### Bugs (à corriger — ne changent pas la conception)

| # | Friction | Lot roadmap |
|---|---|---|
| 12 | « Comment je nettoie ? » — suppression indispensable pendant l'adoption | **D** (verbe Retirer) |
| 8 | Prérequis découverts au fur et à mesure (mission → équipe → intervenant) | **P** |
| 9 | Construction progressive du chantier (site → visite → équipes → missions) | **P** (rien d'obligatoire d'avance) |
| 7 | Dashboard moins pratique que le mobile (« sur PC je cherche, sur mobile je retrouve ») | **V** (source unique visite) |
| — | Rafraîchissement (« je crée, rien n'apparaît ») | **R** |

### Frictions métier (conception — chacune exige son propre cadrage)

| # | Friction | Ce que ça révèle | Statut |
|---|---|---|---|
| 1 | Site/Client pas évident (« Point Discount est le client » pour lui, le site pour l'app ; il pense Servinor → Point Discount → Magasin) | Le modèle à 2 niveaux ne porte pas son monde à 3 niveaux (groupe → enseigne → lieu) | Lot **C** soulage (représentation stable) ; l'ambiguïté de fond reste à observer sur son usage réel |
| 2 | **Planning pensé à l'envers** : lui = Équipe → planning permanent → les interventions arrivent ; l'app = intervention → équipe → jour | LA plus grosse découverte. Le monde est debout, on n'y programme pas chaque occurrence | Chantier planning (gelé) — cette inversion devient son axiome n°1 |
| 3 | Le logiciel ne connaît pas les cycles (Servinor : lun-mer 7h-10h, identique chaque semaine → « créer une semaine, répéter ») | La génération paresseuse actuelle (rythmes par mission) est en-dessous du besoin | Chantier planning — axiome n°2 |
| 4 | **Les exceptions valent plus que le planning** (férié, fermeture, absence, maladie, demande exceptionnelle) — le vrai travail du responsable = gérer les exceptions | Le planning n'est presque jamais modifié ; l'attention doit aller aux écarts | Chantier planning — axiome n°3 ; résonne avec « Aujourd'hui » qui devrait montrer les ÉCARTS |
| 5 | L'équipe est quasiment une **affectation** (Équipe 1 = Olivia), pas un groupe de dix | Le conteneur « équipe » colle mal au nettoyage (1 personne/équipe) | À observer ; ne rien casser — le modèle actuel le permet déjà (équipe d'une personne) |
| 6 | **Rôle « Agent » manquant** : faire une visite, ajouter des photos, consulter SES missions, sans voir le reste | Le modèle de rôles (admin/manager/chef_equipe) est insuffisant pour son entreprise | Chantier autorisation séparé — touche RLS, gardes, écrans ; NE PAS improviser dans la vague adoption |
| 10 | Les preuves ne naissent pas toutes dans MemorIA (photos existantes, WhatsApp) — « MemorIA doit devenir le DOSSIER du chantier, pas forcément l'endroit où tout est produit » | Import = vague 3 (photos galerie, documents, vocaux, import groupé WhatsApp, attribution site/date/auteur) | File d'attente, après la vague adoption |
| 11 | Un AO n'est pas un document mais un **dossier de 15 pièces** (RC, CCAP, CCTP, BPU, DPGF, annexes) | L'analyse AO doit raisonner multi-pièces | Chantier AO séparé (déjà en file) |

## Conséquences gravées

1. La vague adoption (lots R→P de 07-roadmap.md) traite **tous les bugs** et
   n'ouvre AUCUNE des frictions de conception — elles ont chacune leur cadrage.
2. Le futur chantier planning ne partira pas de « générer des occurrences » mais
   des trois axiomes de Guillaume : monde debout / cycles / exceptions d'abord.
   (État actuel vs cible : 01-model.md §planning.)
3. Le rôle « Agent » entre au registre des chantiers (autorisations) — première
   demande de rôle venue du terrain.
4. Boussole inchangée et renforcée : *mémoire opérationnelle d'un monde qui
   tourne*, pas un ERP qui le reconstruit ([[memoire-operationnelle-augmentee]],
   [[refus-erp-rh-pointage-gps]]).
