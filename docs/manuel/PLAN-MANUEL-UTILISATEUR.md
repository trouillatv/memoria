# Manuel Utilisateur Officiel MemorIA — PLAN DÉTAILLÉ (structure avant rédaction)

> Statut : **structure de travail**, pas encore rédigée. Objectif final : 100-150 pages,
> pédagogique et opérationnel, pour un utilisateur novice (chargé d'affaires, conducteur
> de travaux, MOE, responsable d'exploitation) **sans accompagnement**.
>
> Conventions de rédaction (à appliquer dans chaque chapitre) :
> - **Encadré « À retenir »** : 2-3 phrases clés.
> - **Encadré « Erreur fréquente »** : le piège typique + comment l'éviter.
> - **Encadré « Bonne pratique »** : le bon réflexe.
> - **Schéma textuel** : diagramme ASCII (cycles, relations entre objets).
> - **Gabarit MODULE (7 points)** pour chaque module : 1) À quoi ça sert 2) Quand l'utiliser
>   3) Qui l'utilise 4) Ce qu'il faut faire 5) Ce qu'il faut éviter 6) Exemple réel
>   7) Lien avec les autres modules.

---

## VOLUME 1 — MANUEL UTILISATEUR (le présent document)

### Préface
- À qui s'adresse ce manuel · Comment le lire · Conventions · Niveaux de lecture (express / complet)

### Partie I — Comprendre MemorIA (le modèle mental)
- Ch.1 Qu'est-ce que MemorIA ? (une mémoire opérationnelle, pas un ERP/Drive/Trello)
- Ch.2 Le problème que ça résout : la perte de mémoire entre réunions, chantiers, personnes
- Ch.3 La règle d'or : **l'IA propose, l'humain valide** ; l'artefact terrain n'est jamais supprimé
- Ch.4 Le fil conducteur unique : Document → Engagement → Obligation → Sujet → Réunion → Preuve → Clôture
- Ch.5 Pourquoi MemorIA est différent (≠ Procore, Fieldwire, Trello, Monday, SharePoint) — *encadré comparatif*

### Partie II — Les concepts fondamentaux (le cœur)
> Chaque concept : définition simple + à quoi il sert + ce qu'il N'est pas + schéma + exemple.
- Ch.6 Le **Site / Chantier** (l'unité de mémoire d'un lieu)
- Ch.7 La **Réunion** et le **PV** (capturer ce qui se décide)
- Ch.8 Le **Sujet** (l'histoire complète d'un problème dans le temps) — *concept central*
- Ch.9 L'**Action** (un événement à faire) — *encadré : une action n'est PAS un sujet*
- Ch.10 L'**Obligation** (ce qui DOIT exister — l'absence est le signal) — *Action vs Obligation*
- Ch.11 L'**Engagement** (promesse issue d'un AO) — *pourquoi un Engagement devient une Obligation*
- Ch.12 La **Réserve** et l'**Anomalie** (ce qui cloche)
- Ch.13 La **Décision** de chantier (l'objet le plus durable d'un CR)
- Ch.14 La **Preuve** (photo, document, signature) et le **Dossier de preuve**
- Ch.15 Le **Sujet canonique** et le **Glossaire** (DOE = Dossier des Ouvrages Exécutés)
- Ch.16 Schéma récapitulatif : comment tous ces objets se relient au Sujet

### Partie III — Le cycle de vie complet d'un chantier (de bout en bout)
- Ch.17 Avant : l'**appel d'offres** (dossier de démarrage)
- Ch.18 Gagner : **conversion** AO → contrat → site
- Ch.19 Démarrer : injection des **obligations**, casting des intervenants
- Ch.20 Vivre : **réunions**, actions, réserves, **QR entreprises**, photos
- Ch.21 Surveiller : **briefing**, vigilance, obligations négligées
- Ch.22 Prouver : **dossier de preuve**, livraisons, signatures
- Ch.23 Clôturer : réception, levée de réserves, mémoire conservée
- Ch.24 Transmettre : **passation / continuité** (quand une personne part)

### Partie IV — Les modules, un par un (gabarit 7 points chacun)
> Ancré sur les pages réelles de l'application.
- Ch.25 **Tableau de bord** (`/dashboard`) + « Nouveau depuis hier » (inbox QR) + « Aujourd'hui »
- Ch.26 **Chantiers** (`/sites`, fiche site) : journal, photos, livraisons, sous-périmètres (scopes)
- Ch.27 **Sujets** (`/sites/[id]/subjects`) : liste, recherche, fiche sujet (état, vigilance, historique, sources, historique organisation), dépendances entre sujets
- Ch.28 **Obligations** (`/sites/[id]/obligations`) : bibliothèque standard, santé « négligée », provenance source (3 niveaux de confiance), import depuis les engagements
- Ch.29 **Réunions / PV** (`/meetings`) : création, validation du PV (reconstruction, photos, prévisions), briefing de réunion
- Ch.30 **Actions** (`/actions`) : suivi, distribution, statuts
- Ch.31 **Réserves** (`/sites/[id]/reserves`)
- Ch.32 **Preuves** (`/preuves`, `/sites/[id]/preuves`) : dossier consolidé
- Ch.33 **QR entreprises** (`/sites/[id]/qr`, page publique `/a/[token]`) : carnet d'actions, déclaration, statut du lot
- Ch.34 **Contrats** (`/contracts`) : missions, interventions, rapport mensuel, capsule
- Ch.35 **Interventions** (`/interventions/[id]`)
- Ch.36 **Équipes / Intervenants / Clients** (`/equipes`, `/intervenants`, `/clients`) : casting du chantier
- Ch.37 **Planning / Semaine** (`/planning`, `/semaine`)
- Ch.38 **Dossiers de démarrage / AO** (`/tenders`) : nouveau dossier, analyse, synthèse, analyse détaillée, mémoire technique, **engagements** (typage, regroupement, curation), **audit documentaire**, conversion en contrat, mémoire commerciale
- Ch.39 **Atelier IA** (dans un dossier AO) : chat multi-agent, conversations, slash-commands, promotion d'une réflexion en engagement
- Ch.40 **Briefing** (`/briefing`, `/preparation`) : préparer la réunion, envois WhatsApp
- Ch.41 **Documents & Bibliothèque** (`/documents`, import, `/library`, `/comprendre`)
- Ch.42 **Glossaire métier** (`/glossaire`) : termes, alias, sujet canonique
- Ch.43 **Passation / Continuité** (`/handovers`, `/continuite`)
- Ch.44 **Litige** (`/litige`) — *règle stricte : jamais source d'une lecture automatique*
- Ch.45 **Mémoire** (`/memoire`, `/tenders/memoire`)
- Ch.46 **Recherche** (`/recherche`) : recherche par sujet
- Ch.47 **Application mobile / terrain** (`/m`) : sites, interventions, actions sur le terrain
- Ch.48 **Espaces publics par lien** (QR/token) : `/a` actions entreprise, `/i` intervention, `/p` rapport, `/h` passation, `/qr`, `/c`, `/v`

### Partie V — Parcours par rôle
- Ch.49 Chargé d'affaires / MOE (Émeline) : du dépôt d'AO au PV validé
- Ch.50 Conducteur de travaux (Guillaume) : préparer, suivre, prouver
- Ch.51 Responsable d'exploitation (propreté/maintenance) : obligations récurrentes, SLA
- Ch.52 Chef d'équipe / terrain (mobile)
- Ch.53 Direction : synthèse exécutive, ce qui fait perdre, capital client

### Partie VI — L'IA dans MemorIA (transparence)
> Pour chaque brique : ce qu'elle fait / ce qu'elle ne fait pas / ce qu'il faut vérifier.
- Ch.54 Principe : déterministe d'abord, LLM encadré ensuite ; coûts affichés
- Ch.55 Agent **Lecteur AO** · Agent **Mémoire technique** · Agent **Scoreur d'opportunité**
- Ch.56 **Atelier IA** (chat) · **Recherche** · **Extraction d'engagements**
- Ch.57 La **confiance des citations** (exact / section / approximative — jamais de fausse page)
- Ch.58 La **mémoire d'expérience** (sujet canonique → causes → facteurs de réussite → impact)

### Partie VII — Cas d'usage réels (scénarios de bout en bout)
- Ch.59 « Je reçois un AO ce matin » → analyse → engagements → décision go/no-go
- Ch.60 « Ma réunion de chantier est finie » → PV en 10 min → QR aux entreprises
- Ch.61 « Le DOE traîne depuis 4 mois » → sujet, vigilance, historique, relance
- Ch.62 « Une entreprise déclare une action via QR » → inbox → vérification → preuve
- Ch.63 « Un collègue part » → passation sans perte de mémoire
- Ch.64 « Le client conteste » → dossier de preuve

### Annexes
- A. **Glossaire métier** (VRD + propreté, termes + alias)
- B. **FAQ** (50 questions réelles)
- C. **Raccourcis & astuces**
- D. **« MemorIA n'est pas… »** (anti-malentendus)
- E. Index des modules par rôle

---

## VOLUMES COMPAGNONS (documents séparés, à planifier ensuite)
- **VOLUME 2 — Manuel conceptuel « Comment penser MemorIA »** (le plus important : pourquoi chaque objet existe, avec schémas) — peut être fusionné dans Partie I+II si on veut un seul livre.
- **VOLUME 3 — Guide express Émeline (10 pages, captures, zéro théorie)** : créer chantier → réunion → corriger PV → valider → QR → préparer la suivante.
- **VOLUME 4 — Manuel administrateur** (`/admin/*`) : utilisateurs, organisations, glossaire, bibliothèque, documents, exports, sauvegardes, permissions, usage/coûts IA, monitoring.
- **VOLUME 5 — Manuel IA détaillé** (approfondit Partie VI).
- **VOLUME 6 — Argumentaire « Pourquoi MemorIA est différent »** (vente).

---

## Plan de rédaction proposé (par incréments validables)
1. Partie I + II (le modèle mental) — **le plus critique**, à valider en premier.
2. Partie III (cycle de vie).
3. Partie IV (modules) — le plus volumineux, rédigé module par module.
4. Parties V-VI-VII + Annexes.
5. Volumes compagnons (3 = guide express d'abord, utile au pilote).
