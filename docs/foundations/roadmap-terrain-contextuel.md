# Roadmap terrain contextuel

**Date du cadrage** : 2026-06-13  
**Statut** : Roadmap produit proche terme. A traiter prochainement, apres stabilisation du flux terrain actuel.

---

## Decision produit

MemorIA ne doit pas seulement proposer un "mode terrain". MemorIA doit aider l'utilisateur a arriver directement sur le bon lieu, avec le bon contexte, sans multiplier les clics.

Principe central :

> Le contexte doit proposer le bon mode, mais jamais enfermer l'utilisateur.

Le GPS, le QR, la photo ou la note vocale ne doivent jamais servir a suivre une personne. Ils doivent repondre a une seule question :

> De quel lieu parle-t-on maintenant ?

Et jamais :

> Ou est l'utilisateur ?

---

## Les 3 couches

### Couche 1 - Preference utilisateur persistante

`home_preference` reste simple et stable :

```text
dashboard | terrain
```

Exemples :

```text
Guillaume -> dashboard
Adrien    -> terrain
Fred      -> terrain
```

Cette preference sert de fallback au login ou quand aucun contexte fiable n'est detecte. Ne pas ajouter `auto` maintenant.

### Couche 2 - Contexte de lieu temporaire

MemorIA peut detecter ou recevoir le contexte du lieu par :

- QR chantier ;
- GPS a l'ouverture mobile/PWA ;
- lien direct vers un site/intervention ;
- photo rattachee a un chantier ;
- note vocale rattachee a un chantier.

Ce contexte est temporaire. Il peut proposer ou ouvrir une surface terrain adaptee, mais il ne remplace pas definitivement la preference utilisateur.

### Couche 3 - Contexte metier

Une fois le chantier identifie, MemorIA doit remonter ce qui compte maintenant :

- intervention prevue aujourd'hui ;
- reserve ouverte ;
- livraison attendue ;
- actions en attente ;
- notes recentes ;
- consignes d'acces ;
- bouton d'action principal, par exemple `Demarrer visite`.

Exemple cible :

```text
Medipole

Reserve electricien ouverte
Livraison BA13 aujourd'hui
3 actions en attente

Demarrer visite
```

L'utilisateur n'a pas besoin de re-selectionner client, contrat, site et mission a chaque action.

---

## Priorites

### Sprint Adrien 1 - Avant prochaine demo

1. `home_preference` stable : `dashboard` / `terrain`.
2. Home terrain BTP orientee chantier du jour.
3. Onglets mobile sur les fiches pour limiter les allers-retours.
4. QR chantier.

Le QR est prioritaire avant le GPS : plus fiable, plus simple, moins sensible cote privacy.

### Sprint Adrien 2

1. PDF journal chantier.
2. Geolocalisation chantier a l'ouverture mobile/PWA.
3. Creation de site avec latitude/longitude obligatoires.
4. Carte avec pin valide humainement.
5. Proposition automatique par geocoding depuis adresse ou nom du lieu.

UX creation de site :

```text
Adresse / nom saisi
-> proposition geocodee
-> validation humaine
-> pin deplacable si besoin
-> sauvegarde latitude/longitude
```

Ne pas forcer un placement manuel du pin a chaque creation si la proposition est correcte.

### Sprint Adrien 3

1. Compte-rendu chantier.
2. Extraction automatique des actions.
3. Repartition par corps de metier.
4. Preparation WhatsApp du lendemain.

---

## Garde-fous

- Pas de tracking permanent.
- Pas de geolocalisation en arriere-plan.
- Pas d'historique des deplacements.
- Pas de presence automatique.
- Pas de notation ou controle RH.
- GPS uniquement a l'ouverture ou sur action explicite.
- Permission utilisateur obligatoire.
- Message clair : `Pour ouvrir automatiquement le bon chantier.`
- Toujours garder une bascule manuelle via le compte et la navigation existante.

---

## Regle d'architecture

`home_preference` ne porte pas le contexte. Elle reste une preference persistante.

Le contexte courant doit etre resolu ailleurs, par une logique temporaire de type :

```text
source contexte fiable ?
  oui -> proposer / ouvrir le chantier concerne
  non -> fallback home_preference
```

Sources de contexte possibles, par ordre de robustesse probable :

1. QR chantier.
2. Lien direct site/intervention.
3. GPS proche d'un chantier actif.
4. Photo ou note vocale rattachee.

---

## Risque principal

Le risque produit n'est pas de manquer d'IA.

Le risque est qu'Adrien ou Fred perde plusieurs clics pour arriver sur le bon chantier.

QR + home terrain + contexte chantier resolvent ce probleme plus vite qu'une feature IA sophistiquee.

---

## Roadmap — Teaser dynamique sur « Preparer ma visite » (a faire, pas encore code)

Note produit (Guillaume, apres restauration du rituel « Preparer ma visite » +
motive-aware). NON code volontairement — inscrit ici pour plus tard.

Aujourd'hui le bouton dit une etiquette :

```text
Preparer ma visite
```

Demain il doit dire ce qui se passe, SANS ouvrir le panneau — un vrai appel a
l'action :

```text
Preparer ma visite
3 points meritent votre attention
```
```text
Preparer ma visite
Rien n'a change depuis votre derniere visite
```
```text
Preparer ma visite
2 reserves - 1 reunion demain
```

Pourquoi : le bouton passe de « Preparer ma visite » a « il se passe quelque
chose, viens voir ». C'est ce qui transforme une fonction en reflexe.

Faisabilite : les chiffres existent deja (getSiteBriefAction : vigilances,
reserves, changements depuis le dernier CR, reunions proches). Il faut :
- une projection LEGERE (compteur seul, pas le brief complet) calculable cote
  serveur a l'affichage de la fiche, sans ouvrir le panneau ;
- une phrase de synthese deterministe, priorisee (1 ligne max) ;
- un etat calme quand rien ne bouge (« Rien n'a change… ») — la rarete fait la
  valeur, comme pour Presence.

Garde-fou : ne jamais crier. Si tout est calme, le dire calmement. Le teaser
reprend la meme discipline d'apparition que l'assistant de Presence.

---

## Roadmap — Planning terrain unifie « Ma journee » (decision structurante, pas encore code)

Decision produit (Guillaume, apres l'ajout de l'intervention ponctuelle mobile).
NON code volontairement — c'est une evolution majeure, a faire a froid.

### Le changement de philosophie

Le planning ne doit plus etre le planning d'un OBJET (missions, interventions).
Il doit devenir le planning du CONDUCTEUR. Il ne repond plus a « quelles sont mes
interventions ? » mais a « qu'est-ce qui concerne mes chantiers aujourd'hui ? ».

Le conducteur ne pense pas « voici mes missions ». Il pense « qu'est-ce qui
m'attend aujourd'hui ? ». Comme un agenda Google : on voit « Dentiste », pas
« Agenda personnel ». Le planning montre les EVENEMENTS, pas les objets.

### Le planning devient une PROJECTION unifiee (une vue, pas un objet)

En base, rien ne change : Visite = captation, Action = chose a faire,
Intervention = travail execute, Reunion = echange, Mission = gabarit interne.
Le planning les RASSEMBLE en une seule chronologie. Chaque ligne = un evenement
terrain : heure/creneau + type + chantier + intitule + equipe/personne si pertinent.

    08:00  Visite        Medipole   Suivi mensuel
    09:30  Intervention  Medipole   Reprise etancheite terrasse
    11:00  Action        Medipole   Verifier la porte coupe-feu
    14:00  Reunion       Medipole   Reunion OPC
    16:00  Intervention  CHT        Pose garde-corps

Regle d'affichage universelle : `intervention.label ?? mission.name`. Ne JAMAIS
afficher « Mission Ponctuel » a l'utilisateur.

### Mobile — l'ecran « Ma journee » (Passe | A venir)

Onglet bas dedie. Deux sous-onglets seulement :
- **Passe** — « qu'ai-je fait ? » : visites, reunions, interventions, actions
  realisees, chronologiquement, avec resultat (CR, photos, preuves).
- **A venir** — « qu'est-ce qui m'attend ? » : visites prevues, interventions,
  reunions, actions planifiees, par journee.

NE PAS filtrer par type — le TEMPS fait le travail. Le conducteur raisonne par
journee, pas par objet. Dans 6 mois : Aujourd'hui / Demain / Cette semaine.

### La frontiere « date » (evite la duplication)

Le planning montre ce qui est DATE. Une action sans date ni creneau reste dans
l'ecran « Actions » (boite de reception des choses a organiser). Des qu'une action
est planifiee (datee), elle apparait AUSSI dans le planning. Frontiere naturelle.

A terme, sur mobile, « Actions » pourrait devenir « Planning » dans la barre : les
actions planifiees y apparaissent naturellement, les non-planifiees restent dans
leur ecran-inbox.

### Pourquoi c'est structurant

- Evite quatre plannings differents (un par objet).
- Colle au reel : une journee = une succession d'evenements lies aux chantiers.
- C'est la MATIERE PREMIERE du niveau Tournee (niveau 4) : quand le planning
  connait visites + reunions + interventions + actions datees, MemorIA pourra
  proposer un ordre optimise (« tu vas au Medipole a 14 h ; tu as aussi une action
  et une intervention a 500 m — fais-les avant de repartir ») SANS nouvel ecran.

Premiere brique deja posee : l'intervention ponctuelle mobile (mig 189) est un
vrai evenement terrain date, affiche via son `label` — exactement le type de ligne
qui peuplera cette timeline.
