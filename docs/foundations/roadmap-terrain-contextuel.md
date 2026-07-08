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
- Le Planning « Ma journee » (surtout le Passe) est une AUTO-consultation : la journee
  de CELUI qui regarde. Jamais la vue d'un tiers ou d'un manager sur « ce qu'a fait
  l'agent X » — ce serait la ligne ERP-RH franchie.

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

Precision (corrige le wording de mig 189) : la mission systeme « Ponctuel » reste
invisible EN TANT QUE CONCEPT utilisateur, mais ses interventions, elles, DOIVENT
apparaitre dans le planning (via `label`). « Invisible du planning » dans mig 189 ne
vise que la ligne-mission (le gabarit), pas l'evenement terrain. Le planning terrain
affiche les evenements operationnels : visites prevues, interventions recurrentes ET
ponctuelles, reunions chantier. La mission reste un gabarit interne, jamais une ligne.

Nommage — **Decision (Vincent) : garder « Planning » pour l'instant.** C'est le mot le
plus immediatement compris. « Ma journee » est plus chaleureux mais trop limite au
present ; « Agenda chantier » est plus juste mais plus lourd. Reevaluer apres usage
reel (candidats de repli : « Agenda », « Ma journee »).

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

### La barre : CINQ onglets, cinq questions (ne PAS fusionner)

Position (Guillaume) : Planning ne remplace pas l'Accueil (non negociable). Cinq
questions distinctes, non concurrentes :

- **Accueil** — « Que se passe-t-il aujourd'hui ? » (vue synthetique)
- **Planning** — « Comment se deroule ma journee ? »
- **Chantiers** — « Sur quel chantier je veux travailler ? »
- **Actions** — « Qu'est-ce qui reste a faire ? » (inbox des non-datees)
- **Moi** — profil, preferences, historique personnel

Arbitrage du 6e emplacement (5 onglets + le ➕ central = 6). Le ➕ n'est PAS un onglet :
c'est le bouton de creation. Il faut donc retomber a 4 onglets + ➕. Deux options
s'opposent :

- **Option A (recommandee)** : sortir **Moi** de la barre (avatar en haut a droite).
  Barre = Accueil · Planning · ➕ · Chantiers · Actions. « Moi » est le seul onglet
  qu'on n'ouvre jamais dans l'urgence terrain.
- **Option B** (proposee ensuite par Guillaume) : sortir **Actions** de la barre
  (Actions devient un ecran « boite de reception » atteignable depuis Accueil/Planning).
  Barre = Accueil · Planning · ➕ · Chantiers · Moi.

Point de vigilance sur l'option B : Planning ne montre QUE le date ; Actions est
l'inbox du NON-date. Ce sont les deux etats d'une meme question « ce qui reste a
faire » (planifie / non planifie) — c'est exactement la frontiere date. Retirer
Actions de la barre affaiblit l'un des deux ancrages de cette frontiere et enterre
le seul contenu que le Planning ne sait pas montrer (le non-planifie a organiser).
D'ou la preference pour l'option A : garder le couple Planning(date) / Actions(non
date) visible en permanence, faire ceder « Moi ».

**Decision (Vincent, tranchee) : Option A.**
Barre mobile = **Accueil · Planning · ➕ · Chantiers · Actions**. « Moi » sort de la
barre et passe en **avatar en haut a droite**. Raison : Planning = date, Actions =
non date / a organiser ; on garde les deux visibles (le couple ne se casse pas).

### Planning : pas seulement « Aujourd'hui »

Trois sections + une memoire :
- **Aujourd'hui** / **Demain** / **A venir** (preparation)
- **Historique / Passe** (justification — « quand suis-je passe au Medipole ? »)

Un conducteur passe autant de temps a PREPARER qu'a JUSTIFIER. Le planning devient
aussi une memoire chronologique. Passe = « qu'ai-je fait ? » (avec resultat : CR,
photos, preuves). A venir = « qu'est-ce qui m'attend ? ».

### Chaque ligne porte un ETAT

Ne pas montrer seulement heure + type + chantier. Montrer l'ETAT, lisible d'un
coup d'oeil :

    08:00  Visite        Medipole   ✓ Terminee
    09:30  Intervention  Bloc B     ▶ En cours
    14:00  Reunion       CHT        ⏳ Dans 45 min

Le conducteur voit immediatement ce qui est fait / en cours / a venir.

### Planning devient le POINT D'ENTREE

Aujourd'hui on entre par un chantier. Demain :

    J'ouvre MemorIA -> Planning -> je choisis l'evenement -> Preparer -> Executer -> Debrief

Le chantier devient un CONTEXTE ; le planning devient la porte d'entree du cycle.

Nuance (arbitrage de landing) : « point d'entree » = REFLEXE, pas entonnoir force. Le
landing par defaut reste pilote par `home_preference` + resolution de contexte (QR/GPS
-> chantier). Planning est un onglet PROMU (voire le landing pour qui le prefere),
jamais un passage oblige — sinon on casse « le contexte propose, n'enferme jamais ».

### Le ➕ : STABLE, jamais contextuel (seul l'ORDRE change)

Correction (Guillaume) : ne PAS rendre le ➕ contextuel (options qui apparaissent/
disparaissent selon l'ecran = interface imprevisible). Le ➕ garde TOUJOURS les cinq
creations : Visite · Reunion · Intervention · Action · Photo/note. « + » = creer,
partout, la meme chose.

Seul l'ORDRE peut s'adapter au contexte :
- sur une fiche chantier : Action, Photo, Visite, Reunion, Intervention
- sur le Planning : Visite, Intervention, Reunion, Action, Photo

On aide sans jamais donner l'impression qu'une option a disparu.

### La vraie evolution : d'une app orientee DONNEES a une app orientee RYTHME

Ce n'est plus « Visites / Reunions / Actions / Interventions ». C'est le cycle du
conducteur : **Je prepare -> Je realise -> Je termine -> Je retrouve.** Le planning
en devient la porte d'entree naturelle, sans remettre en cause les objets metier.

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
