# MemorIA — Mode d'emploi

**Pour Guillaume et son équipe pilote**
**Version pilote · mai 2026**

---

## Sommaire

1. [Ce que fait MemorIA (et ce qu'il ne fait pas)](#1-ce-que-fait-memoria-et-ce-quil-ne-fait-pas)
2. [Première connexion](#2-première-connexion)
3. [Les trois rôles](#3-les-trois-rôles)
4. [Le Tableau de bord (manager)](#4-le-tableau-de-bord-manager)
5. [Les interventions du jour](#5-les-interventions-du-jour)
6. [La Vue Semaine](#6-la-vue-semaine)
7. [Le Briefing du soir](#7-le-briefing-du-soir)
8. [Les Missions](#8-les-missions)
9. [Les Équipes](#9-les-équipes)
10. [Les Sites — la mémoire vivante du lieu](#10-les-sites--la-mémoire-vivante-du-lieu)
11. [Les Contrats](#11-les-contrats)
12. [Les Appels d'Offres (AO) — votre wedge premium](#12-les-appels-doffres-ao--votre-wedge-premium)
13. [La Bibliothèque](#13-la-bibliothèque)
14. [Les Intervenants (manager + admin)](#14-les-intervenants-manager--admin)
15. [Le Dossier de preuves](#15-le-dossier-de-preuves)
16. [Le mode mobile chef d'équipe](#16-le-mode-mobile-chef-déquipe)
17. [Le bouton Feedback](#17-le-bouton-feedback)
18. [Administration (admin only)](#18-administration-admin-only)
19. [Doctrines à respecter pendant le pilote](#19-doctrines-à-respecter-pendant-le-pilote)
20. [Que faire si…](#20-que-faire-si)

---

## 1. Ce que fait MemorIA (et ce qu'il ne fait pas)

### Ce que c'est
**MemorIA = la mémoire opérationnelle augmentée de votre entreprise de nettoyage.**

Il transforme vos traces dispersées (notes terrain, photos, signalements, preuves d'accès, anomalies, documents AO) en **mémoire exploitable au bon moment** : quand un nouvel AO arrive, quand un chef d'équipe reprend un site, quand un client conteste une prestation, quand un manager affecte une équipe.

### Ce que ce n'est PAS
- ❌ **Pas un ERP RH**. Pas de paie, pas de pointage, pas de congés.
- ❌ **Pas un outil de surveillance**. Pas de GPS, pas de productivité par personne.
- ❌ **Pas un chatbot qui rédige à votre place**. MemorIA *contextualise*, il ne génère pas.
- ❌ **Pas un drive**. Les documents servent à nourrir la mémoire, pas à être stockés bêtement.

### La promesse
Au bout de 6 mois, vous saurez sur n'importe quel site :
- Ce qui s'y passe régulièrement
- Ce qui revient comme problème
- Qui le connaît déjà
- Quelles preuves vous y avez accumulées
- Ce que vous y avez promis dans le contrat

Et tout ce capital sera **réutilisable** dès qu'un nouvel AO du même type arrive.

---

## 2. Première connexion

### URL d'accès
Votre administrateur vous communique l'URL (par exemple `https://memoria.exemple.fr`).

### Login
- Email + mot de passe.
- À la première connexion, **vous devez changer votre mot de passe**.
- Si vous oubliez : « Mot de passe oublié » sur la page login.

### Rôle attribué
Votre administrateur vous a affecté un rôle (admin / manager / chef d'équipe). Ce rôle détermine ce que vous voyez.

---

## 3. Les trois rôles

| Rôle | Pour qui | Accès |
|---|---|---|
| **Admin** | Vous (Guillaume) et 1-2 personnes de confiance maximum | Tout, y compris la gestion des utilisateurs, le monitoring IA, le feedback admin |
| **Manager** | Chefs d'équipe expérimentés, responsables d'exploitation, commercial | Tableau de bord, Semaine, Sites, Contrats, AO, Intervenants, Missions, Équipes |
| **Chef d'équipe** | Agents qui mènent les interventions sur le terrain (Joseph, Tarek, Sandrine…) | Vue mobile dédiée `/m` — interventions du jour, dépôt photos, notes vocales, signalements |

Un chef d'équipe **ne voit pas** le dashboard desktop. Quand il se connecte, il atterrit directement sur l'écran mobile adapté à la prestation terrain.

---

## 4. Le Tableau de bord (manager)

URL : `/dashboard` — c'est votre page d'accueil quand vous vous connectez (sauf chef d'équipe).

### Ce que vous y voyez (de haut en bas)

1. **Le bonjour** : prénom + nombre de contrats actifs.
2. **Ce que les lieux disent ce matin** (si signal IA pertinent) : 1 phrase courte qui émerge d'un site. Rare par construction. Doctrine : *l'IA qui parle tout le temps devient du bruit*.
3. **Zone Vigilance (en rouge bordeaux, en haut)** :
   - AO à rendre dans les 7 jours (si vous en avez)
   - Signalements terrain des dernières 24 h
   - Engagements à surveiller cette semaine
   - Contrats sous tension
4. **Widget Pipeline AO** : 3 chiffres (Actifs / À rendre / Gagnés ce mois). Cliquable → `/tenders`.
5. **Bouton « Préparer ma défense »** : raccourci vers le mode litige.
6. **4 stats agrégées** (semaine, capital, AO, anomalies).
7. **Compteurs** : dossiers clôturés ce mois.
8. **Liste des contrats** : groupés par « Demandent attention », « En bonne progression », « Inactifs ».
9. **Capital cumulé** : ligne sobre tout en bas — interventions documentées · photos · incidents traités depuis le démarrage.
10. **Activité récente** : 8 derniers événements globaux.

### Règle d'or
**Silence positif** : si la zone vigilance est vide, c'est que tout va bien. Pas de carte qui dit « tout va bien » à votre place — c'est l'absence qui parle.

---

## 5. Les interventions du jour

URL : `/aujourdhui` — vue centrée sur le présent.

### Ce que vous y voyez

- **Header** : la date du jour, 4 stats (Prévues / En cours / Terminées / À traiter).
- **Bandeau IA** « Ce que les lieux disent » (s'il y a un signal pertinent).
- **Dette opérationnelle (en rouge)** :
  - Interventions sans équipe affectée aujourd'hui
  - Passages en retard à régulariser
- **Planning du jour** en flux chronologique unique :
  - Heure à gauche (ex. `6h30` ou `06h30 – 08h00 (1h30)`)
  - Site + mission
  - Équipe affectée (ou badge ambre « Non-affecté »)
  - Statut (planifié / en cours / exécuté / validé / sauté)

### Important
**Pas de notion de « créneau »** dans MemorIA — uniquement des **heures réelles**. Une intervention à 6h30 est listée à 6h30, pas dans « Matin ».

### Liens en bas
- *Briefing du soir* (préparer demain)
- *Vue Semaine* (zoom hebdomadaire)

---

## 6. La Vue Semaine

URL : `/semaine` — la grille principale pour organiser.

### Deux vues disponibles
- **Site × Jour** (par défaut) : 1 ligne par site, 7 colonnes pour les 7 jours.
- **Équipe × Jour** : 1 ligne par équipe.

### Ce que chaque cellule affiche
- **Aucune intervention** : un tiret discret « — ».
- **1 intervention** : `●` + heure de la 1ère intervention (ex. `6h30`).
- **Plusieurs** : `●●` + heure de la 1ère.
- **Sans équipe affectée** : `◯` ambre + texte « Non-affecté ».
- **Équipe dominante** : badge couleur de l'équipe.

### Ce que vous pouvez faire
- **Click cellule** → drawer latéral avec le détail de chaque intervention.
- **Drag-and-drop** une cellule vers un autre jour → replanifie l'intervention. **L'heure est préservée** si vous restez dans le même cadre.
- **Bouton « Modifier heure »** dans le drawer → ouvre un dialog pour saisir heure début/fin précises.
- **Bouton « Réassigner équipe »** dans le drawer → ouvre le dialog avec liste d'équipes.

### Bandeau Vigilance (en haut, en rouge)
- Interventions **sans équipe**
- **Conflits d'équipe** : une équipe affectée à deux sites différents sur des horaires qui se chevauchent.

### Création d'intervention
Bouton « Planifier » dans le header :
- Mission (obligatoire)
- Date (obligatoire)
- **Horaire** : heure de début **obligatoire**, heure de fin optionnelle (ex. `06:30` → `08:00`)
- Équipe (par défaut de la mission, ou choisir explicitement)

### Export
Bouton « Exporter » → fichier Excel de la semaine (1 ligne par intervention, avec Date, Jour, Horaire, Contrat, Site, Mission, Équipe, Couleur, Effectif, Statut).

---

## 7. Le Briefing du soir

URL : `/briefing`

Pendant que `/aujourdhui` suit le présent, **le briefing prépare demain**. Vous y voyez ce qui est planifié, ce qui manque (équipe), ce qu'il faut anticiper.

---

## 8. Les Missions

URL : `/missions`

### Qu'est-ce qu'une mission ?
Une **mission** = une prestation récurrente sur un site. Exemple : *« Bionettoyage bloc opératoire CHT Magenta »*.

### Hiérarchie
```
Contrat
   └── Site (1 ou plusieurs sous le contrat)
        └── Mission (1 ou plusieurs sur le site)
             └── Templates de récurrence (matin, après-midi, jours fixes…)
                  └── Interventions matérialisées (1 par occurrence)
```

### Création d'une mission
Depuis la page d'un contrat : `/contracts/[id]/missions/new`. Vous remplissez :
- Site
- Nom de la mission
- Description (optionnelle)
- **Cadence** : quotidienne / hebdomadaire / bi-mensuelle / mensuelle / à la demande
- **Engagements liés** (les promesses du contrat qu'elle exécute)
- **Checklist par défaut** (les tâches qui seront copiées sur chaque intervention)

### Étape suivante (IMPORTANT)
Une fois la mission créée, **il faut créer au moins un template de récurrence** pour que les interventions soient effectivement programmées. Sans template → aucune intervention dans la grille.

---

## 9. Les Équipes

URL : `/equipes`

### Ce que c'est
Une **équipe** = un conteneur logistique. Plusieurs chefs d'équipe + agents y sont rattachés. Une équipe a un nom, une couleur (pour identification visuelle), un référent.

### Doctrine importante
- Une équipe a une **couleur visible** dans toute l'app (sur les cellules de la semaine, dans les badges).
- L'effectif (nombre d'agents) est **descriptif**, jamais une métrique de performance.
- **« Non-affecté »** est un statut ambre normal — pas une alarme.

### Ce que vous pouvez faire
- Créer / archiver une équipe
- Ajouter / retirer des membres
- Définir un référent (membre qui a un rôle de coordination informel)

---

## 10. Les Sites — la mémoire vivante du lieu

URL : `/sites` → liste, puis click sur un site → fiche détaillée `/sites/[id]`

### Ce que la fiche site contient

1. **Identité** : nom, client, adresse, contrat lié.
2. **À savoir** : consignes persistantes attachées au site (ex. *« Toujours passer par le SAS B après 19h »*).
3. **Cockpit opérationnel** : 4 stats inline (avancement, anomalies, photos…).
4. **Lectures du lieu** (IA) : 1 ou plusieurs fragments générés par l'IA qui font écho à des prestations passées ou des documents. **Pas une vérité**, juste un « écho juste ». Visible uniquement s'il y a quelque chose à dire.
5. **Mémoire du lieu (TraceStream)** : la chronologie narrative du site.
   - **Légende** en haut avec les types présents (badges colorés)
   - **Prestations récurrentes** (vert émeraude) : ce que le site reçoit comme prestations cumulées
   - **Événements** : chronologie des notes d'intervention, signalements, photos, accès…
   - Les **doublons** sont automatiquement dédoublonnés (texte identique sur même jour = une seule ligne).
   - Les **signalements génériques répétés** sont collapsés (« materiel cassé — 4 signalements »).
6. **Rythme du lieu** (14 derniers jours) + galerie photos.
7. **Anomalies** : liste des incidents signalés.
8. **Équipes qui connaissent ce site** (all-time) : équipes ayant fait des interventions, avec nombre de passages et dernier passage.
9. **Continuité humaine** : succession de présences (anonymisée si moins de 4 personnes distinctes — verrou anti-ré-identification).
10. **Ce qui revient ici** : signaux récurrents émergeant des notes terrain.
11. **Documents rattachés** : CCTP, plans d'accès, fiches sécurité.

### Lecture
Chaque ligne de la Mémoire du lieu a un **badge texte explicite** pour que vous sachiez immédiatement l'origine :
- 🔵 **Note d'intervention** (bleu) : saisie par l'agent sur l'intervention
- 🟠 **Signalement** (orange) : anomalie déclarée
- 🟠 **Signalements groupés** : N anomalies similaires collapsées
- 🟣 **Note de site** (violet) : note libre attachée au site
- 🩷 **À savoir** (rose) : consigne persistante
- 🩵 **Photo** (cyan) : passage photo
- 🟢 **Accès** (émeraude) : passage documenté
- 🟢 **Prestation** : item de checklist exécuté

---

## 11. Les Contrats

URL : `/contracts` → liste, puis click → fiche `/contracts/[id]`

### Ce que la fiche contrat contient

- **Identité** : nom, client, dates début/fin, statut (active / paused / closed).
- **Engagements** : ce qui a été promis (liste, avec preuves requises).
- **Sites du contrat**.
- **Missions actives**.
- **AO d'origine** (si le contrat vient d'un AO gagné).
- **Documents rattachés**.
- **Boucle de preuve** : 5 segments (PROMIS / PLANIFIÉ / EXÉCUTÉ / PROUVÉ / VALIDÉ) — un contrat « sous tension » est un contrat dont au moins un segment faiblit.

### Vue spéciale
- **Rapport mensuel** : génération de rapport synthétique pour le client.
- **Convertir un AO en contrat** : wizard `/tenders/[id]/convert` qui crée le contrat à partir d'un AO gagné, avec les engagements extraits.

---

## 12. Les Appels d'Offres (AO) — votre wedge premium

URL : `/tenders`

### C'est ici que MemorIA est le plus puissant

Pour chaque AO, vous obtenez :
1. **Upload PDF** (CCTP, RC, BPU)
2. **Extraction automatique** du texte (OCR si scan)
3. **Analyse IA en 3 phases** :
   - Lecteur AO (synthèse, contraintes, risques, checklist)
   - Mémoire technique (génération d'un brouillon de mémoire technique exploitable)
   - Scoring d'opportunité (0-100)

### Vues disponibles sur un AO
- **Synthèse** : résumé + score + **Capital client** (combien d'interventions / sites / contrats / anomalies traitées / photos / documents vous avez déjà avec ce client — factuel, pas de score).
- **Analyse détaillée** : contraintes par sujet, risques par sévérité, checklist, sources documentaires.
- **Mémoire technique** : le texte exploitable, modifiable, avec **insertion de preuves** depuis votre capital.
- **Atelier IA** : conversation avec 6 agents spécialisés (Lecteur AO, Mémoire technique, Conformité, Financier, Terrain, Contradicteur). **L'agent Contradicteur** challenge votre approche — utilisez-le.

### Sources documentaires cliquables
Sous la synthèse et l'analyse détaillée, vous voyez la liste des documents que l'IA a utilisés. **Chaque ligne est cliquable** → ouvre le document complet. Si un document est de type `litige`, il est signalé avec une icône balance et un avertissement « consulter avec prudence ».

### Mémoire commerciale (AO précédents)
Avant soumission, MemorIA vous montre les **AO similaires passés** (gagnés OU perdus) avec leur outcome. Lisez les « pourquoi perdus » avant de répondre.

### Outcome (après soumission)
Quand vous avez soumis et reçu une réponse, vous **renseignez l'outcome** :
- `won` / `lost` / `withdrawn` / `not_responded`
- + raison libre (optionnelle)
- + tag (prix / qualité / relation / timing / autre)

Cet outcome alimente la mémoire commerciale pour les AO suivants. **C'est cumulatif**.

### Note vocale du closing (recommandé)
Juste après dépôt, enregistrez **1 minute** de voix qui dit *« sur quoi on a parié, qu'est-ce qui était tendu, qu'est-ce que je sens »*. Cette note vous sera ressortie au prochain AO similaire. **C'est la signature MemorIA** — personne ne fait ça.

### Pipeline AO sur le dashboard
3 chiffres compacts en haut : Actifs / À rendre / Gagnés ce mois. Et un **bandeau rouge** vous avertit si un AO doit être rendu dans les 7 jours.

---

## 13. La Bibliothèque

URL : `/documents`

### Ce que c'est
Le **réservoir documentaire vivant** de MemorIA :
- Documents de référence (CCTP types, protocoles, fiches sécurité)
- Documents de site (plans d'accès, photos archivées, attestations)
- Documents de contrat (annexes signées, avenants)
- AO historiques (gagnés et perdus, avec leur outcome)
- Litiges (consultation prudente, jamais source automatique de lecture IA)

### Visibilité
Chaque document a un **niveau de visibilité** :
- `admin_only` : visible par admin uniquement
- `manager` : admin + manager
- `operations` : tous les rôles internes
- `field` : visible côté mobile chef d'équipe
- `client_portal` : un jour, visible client (pas encore implémenté)

### Indexation
Chaque document chargé est **automatiquement chunké et embeddé** par l'IA. Cela alimente le matcher AO et les résonances site → document. **Coût : quelques centimes par document.**

---

## 14. Les Intervenants (manager + admin)

URL : `/intervenants`

### Important — Doctrine spéciale
Cette page **donne accès aux fiches individuelles** des agents (nom, sites connus, équipes, interventions passées). C'est une **transgression assumée** de notre doctrine principale « personne jamais sujet ». Elle est **gated** par un kill switch et **chaque consultation est tracée**.

### Ce qu'on peut faire ici (et ce qu'on ne fera JAMAIS)

| ✅ Autorisé | ❌ INTERDIT |
|---|---|
| Voir les sites qu'une personne connaît | Comparer 2 personnes côte à côte |
| Voir son historique d'interventions documentées | Calculer son taux de réussite |
| Voir son rôle, type de contrat (CDI/CDD), commune | Score, ranking, « top performers » |
| Voir les anomalies sur ses interventions | Filtrer « les agents lents » |
| Voir ses collaborateurs (équipes partagées 2 ans) | Pression RH, prédiction démission |

### Page liste `/intervenants`
- Grid de cards (3 par ligne)
- Pour chaque agent : avatar initiales, nom, rôle, badges équipes, 2 KPIs (Interventions / Sites), dernier passage
- Tri **alphabétique** uniquement — aucun classement

### Bouton « Nouvel intervenant »
- Email, nom + prénom, téléphone, commune, rôle, type de contrat (CDI / CDD / CDI Chantier)
- Mot de passe initial **partagé** : `memoria2026` — communiqué oralement à l'agent
- L'agent **doit changer son mot de passe** à la 1ère connexion

### Page détail `/intervenants/[id]`
1. **Bandeau ambre rappelant la doctrine** : « jamais évaluative »
2. **Header** : avatar, rôle, badge type contrat, commune, téléphone, équipes
3. **Présence cumulée** : 4 compteurs (Interventions / Sites / Contrats / Traces)
4. **Galerie photos** déposées (jusqu'à 12 thumbnails + lightbox)
5. **Rythme — 14 derniers jours** : points par jour avec tooltip
6. **Densité — 90 derniers jours** : heatmap calendrier (lundi en haut, dimanche en bas)
7. **Sites connus** + **Contrats travaillés** (grid 2 cols)
8. **Équipes fréquentées sur 2 ans** : actuelles + quittées
9. **A travaillé avec** : collaborateurs ayant partagé une équipe sur 2 ans
10. **Présence lors d'incidents** : anomalies survenues sur ses interventions (distingue « signalée par cette personne » vs juste présence)
11. **Interventions récentes** (20 dernières)
12. **Traces laissées** : notes, anomalies, photos, voice notes

### Quand l'utiliser
- Avant d'affecter une équipe à un AO : vérifier qui connaît déjà le client
- Quand un agent doit reprendre un site qu'un autre a couvert
- Pour suivre la continuité opérationnelle (jamais pour juger)

### Quand NE PAS l'utiliser
- Pour préparer un entretien annuel
- Pour décider d'une sanction
- Pour comparer deux personnes
- Pour parler en réunion d'équipe (« regardez celui-là il a moins fait que… »)

---

## 15. Le Dossier de preuves

URL : `/preuves`

Le **classeur des artefacts** réutilisables. Vous y retrouvez :
- Photos par site, par contrat
- Anomalies traitées
- Validations clients
- Voice notes attachées aux preuves

### Mode litige
Bouton « Préparer ma défense » sur le dashboard. Compile rapidement les preuves d'un site/contrat dans un dossier exportable.

### Partage public sécurisé
Pour chaque preuve, vous pouvez générer un **token de partage** (URL signée, expirable) à envoyer à un client en cas de contestation. Format `/p/[token]` — l'audit log capture chaque consultation.

---

## 16. Le mode mobile chef d'équipe

URL : `/m` (sur smartphone — accès direct depuis le navigateur)

### Pour qui
Les chefs d'équipe sur le terrain. Joseph, Tarek, Sandrine.

### Ce qu'ils voient

1. **Date** avec navigation jour précédent / suivant
2. **Bandeau rouge « À régulariser »** (interventions passées dont la clôture n'est pas faite)
3. **Bandeau rouge « Tâches non terminées »** (manques sur les 7 derniers jours)
4. **Liste des interventions du jour** : 1 carte par intervention avec :
   - Mission + site
   - Horaire de prestation
   - Statut
   - Équipe affichée
5. **Lien Mes notes terrain** (audio + texte)

### Une intervention sur mobile
Click sur une intervention → page détaillée :
- **Démarrer l'intervention** (bascule en `in_progress`)
- **Checklist** : cocher les items
- **Photo** : ajouter des photos (avant / pendant / après / anomalie / preuve)
- **Voice note** : laisser une note vocale (≤ 3 minutes, transcription automatique)
- **Signaler une anomalie** : type + description libre + photo optionnelle
- **Preuve d'accès** : confirmer la prise et la restitution des clés/badges
- **Clôturer** : passe l'intervention en `completed`

### Doctrine mobile
- **Ultra simple, tap-friendly, non administratif**
- L'agent **ne saisit JAMAIS son temps personnel** — il documente la prestation, pas son heure d'arrivée
- **Aucun classement** de l'agent dans le mobile

---

## 17. Le bouton Feedback

### Où le trouver
Bouton **rond noir flottant** en bas à droite, sur **toutes les pages du dashboard desktop** (manager + admin). Pas sur mobile chef.

### Ce qu'il fait
Click → dialog avec :
- Textarea (max 2000 caractères)
- Compteur caractères
- Page actuelle affichée en mono (pour que l'admin sache où vous étiez)
- Bouton « Envoyer »

### À utiliser pour
- Un bug rencontré
- Une suggestion
- Une frustration UX
- Une question « j'ai pas compris ça »

### Côté admin
Vos retours arrivent dans `/admin/feedback` avec un statut (À traiter / Traité / Spam). L'admin lit, marque, vous oubliez. **Pas de réponse automatique** — c'est de la communication humaine, pas un ticket support.

---

## 18. Administration (admin only)

URL : `/admin`

### Nav admin
- **Utilisateurs** (`/admin/users`) : gérer les comptes (admin seulement)
- **Préparation** : outils de préparation/maintenance
- **Monitoring** (`/admin/monitoring`) : santé IA + adoption produit
- **Feedback** (`/admin/feedback`) : retours utilisateurs
- **Backfill IA** : retraitement de documents anciens

### Monitoring — 2 onglets
**Monitoring IA** :
- Sous-onglet *APIs IA — Mémoire* : statut des providers Gemini/OpenAI (clé OK ? réponse OK ?)
- Sous-onglet *Console IA — 7 derniers jours* :
  - 6 cards (Appels, Erreurs, Coût XPF + USD, Projection mois, Tokens entrée, Tokens sortie)
  - IA utilisées (chips modèles + nombre d'appels)
  - Coût par feature (table détaillée)
  - Dernières erreurs
  - 50 derniers appels (avec tokens, coût, durée, statut)
- Sous-onglet *Production IA — 7 derniers jours* : santé 24h + production (docs analysés, résonances B1/B2 actives)

**Adoption** :
- Statistiques d'adoption produit
- Journal d'activité par utilisateur (audit log)
- Indicateurs opérationnels

### Quand surveiller
- **Tous les jours pendant le pilote** : un coup d'œil au coût IA pour vérifier qu'on ne dérape pas
- Si erreurs > 5 : investiguer immédiatement
- Si projection mensuelle XPF > 5000 F : alerter Vincent

---

## 19. Doctrines à respecter pendant le pilote

Ces règles sont **gravées dans le code** par des tests automatiques. Elles ne sont pas négociables — elles protègent l'identité du produit.

### Règle 1 — On organise, on ne surveille pas
- **L'équipe** est un conteneur logistique
- **L'agent** apparaît dans les artefacts qu'il dépose, jamais comme sujet d'analyse
- **Pas de classement** entre personnes nulle part dans l'app

### Règle 2 — Les heures réelles, jamais les créneaux abstraits
- Pas de « Matin / Après-midi / Soir » dans l'UI
- Heure de prestation honnête (`06h30 – 08h00`) saisie par le chef au moment de la planification

### Règle 3 — La mémoire au bon moment
- **Silence positif** : si rien à dire, l'IA se tait. C'est un signe de qualité.
- 1 fragment maximum par lecture matin
- Les résonances apparaissent à l'ouverture d'un AO, d'un site, d'une intervention — **pas en push**

### Règle 4 — Les preuves sont des artefacts, pas des KPI
- Une photo = une trace, pas une note
- Une anomalie signalée = une mémoire, pas un score
- Un agent qui dépose 30 notes terrain n'est pas « meilleur » qu'un qui en dépose 5 — c'est une donnée descriptive, jamais comparative

### Règle 5 — Hors-UI = encore plus prudent
Pendant le pilote, **ne JAMAIS** :
- Faire un screenshot MemorIA avec un nom d'agent et l'envoyer sur WhatsApp
- Dire en réunion « regardez les chiffres de X dans MemorIA »
- Communiquer un compteur individuel à un agent (« tu as fait 14 anomalies, c'est bien »)

L'UI protège la doctrine. **Vous pouvez la casser hors-UI en 2 phrases.**

---

## 20. Que faire si…

### …j'ai un bug ?
1. Bouton **Feedback** flottant, en bas à droite
2. Décris ce qui s'est passé, la page actuelle est capturée automatiquement
3. L'admin verra ton retour dans `/admin/feedback`

### …je ne vois pas la page Intervenants alors qu'on m'a dit qu'elle existait ?
La page est **gated par un flag** côté serveur (kill switch). Demande à ton admin de vérifier que `INTERVENANTS_PAGE_ENABLED=true` est bien activé.

### …un chef d'équipe ne peut pas démarrer son intervention sur mobile ?
- Vérifie qu'une équipe est bien **affectée** à l'intervention (l'app refuse `in_progress` sans équipe — doctrine V3)
- Vérifie que l'intervention est bien `planned` (pas `skipped` ou autre)

### …un drag-and-drop sur la semaine est refusé avec « Conflit d'équipe » ?
L'équipe affectée est déjà sur un AUTRE site sur des horaires qui chevauchent. Soit :
- Réassigne l'équipe sur l'autre intervention en conflit
- Soit déplace sur un jour différent
- Soit modifie l'heure pour ne plus chevaucher

### …je veux créer un nouveau site / contrat / mission ?
- **Contrat** : depuis `/contracts/new` ou converti depuis un AO gagné (`/tenders/[id]/convert`)
- **Site** : depuis la page d'un contrat (`/contracts/[id]/sites/new` ou équivalent)
- **Mission** : depuis la page d'un contrat (`/contracts/[id]/missions/new`)

### …un agent est parti et j'ai un nouvel arrivant qui le remplace ?
- Le nouvel agent : **création depuis `/intervenants`** (bouton « Nouvel intervenant »)
- Ajoute-le dans **les équipes** où il doit travailler (`/equipes/[id]`)
- L'agent qui part : ne le supprime PAS — il faut conserver ses traces pour l'audit. Désactive juste son rattachement aux équipes (`left_at`)

### …les coûts AI explosent ?
- Va sur `/admin/monitoring?tab=ia&subtab=console`
- Regarde la projection mensuelle XPF
- Si > 5000 F : alerte Vincent immédiatement
- Possibles causes : trop d'analyses AO relancées, OCR sur trop de documents, embeddings batch trop gros

### …je veux exporter les données pour un audit ?
- Vue Semaine : bouton « Exporter » → Excel
- Dossier de preuves : génération de dossier exportable
- Pour un export complet de la base : demande à l'admin technique (`pg_dump` sur la base Postgres)

### …un client conteste une prestation ?
1. Va sur `/preuves` ou directement sur le contrat concerné
2. Trouve la preuve (photo, signature, anomalie traitée, etc.)
3. Génère un **token de partage** (URL signée expirable)
4. Envoie l'URL au client par WhatsApp ou email
5. Le client visualise sans login. L'audit log enregistre chaque consultation.

### …je perds mon mot de passe ?
- « Mot de passe oublié » sur la page login
- Si bloqué : admin peut forcer un reset depuis `/admin/users`

---

## Annexes

### Glossaire

- **Intervention** : 1 prestation effective sur 1 site, à 1 date donnée. Matérialisée à partir d'un template de mission.
- **Mission** : prestation récurrente définie sur un site, avec sa cadence et sa checklist par défaut.
- **Template d'intervention** : la règle de récurrence (« tous les lundis matin », « le 1er et 15 du mois »…).
- **Engagement** : promesse faite dans un contrat (« nettoyage quotidien des sanitaires », « passage hebdomadaire vitres »).
- **Preuve** : artefact concret (photo, anomalie traitée, validation client) qui démontre l'exécution d'un engagement.
- **Résonance** : signal IA qui fait écho à un fragment passé (lecture juste, jamais une vérité).
- **À savoir** : consigne persistante attachée à un site (langage non-directif).
- **Anomalie** : incident signalé par un chef d'équipe (catégorie + description optionnelle).

### Raccourcis URL utiles

| Page | URL |
|---|---|
| Tableau de bord | `/dashboard` |
| Aujourd'hui | `/aujourdhui` |
| Semaine | `/semaine` |
| Briefing du soir | `/briefing` |
| Sites | `/sites` |
| Contrats | `/contracts` |
| AO | `/tenders` |
| Mémoire AO | `/tenders/memoire` |
| Documents | `/documents` |
| Missions | `/missions` |
| Équipes | `/equipes` |
| Dossier preuves | `/preuves` |
| Intervenants | `/intervenants` |
| Mode mobile chef | `/m` |
| Administration | `/admin` |
| Mon compte | `/account` |

---

## Mot de la fin

MemorIA n'est pas un outil que vous configurez une fois pour toutes. C'est un **organisme qui apprend** à mesure que vous l'utilisez. Chaque photo déposée, chaque note terrain, chaque AO clôturé enrichit la mémoire collective de votre entreprise.

**Le pilote dure 30 jours.** À la fin :
- Si Guillaume utilise activement /aujourdhui et /semaine
- Si au moins 50 interventions ont été documentées
- Si au moins 5 anomalies ont été traitées via MemorIA
- Si aucune doctrine n'a été cassée hors-UI

… le pilote est un succès. On peut alors basculer en production réelle et étendre à d'autres équipes.

**Bon pilote.**

— L'équipe MemorIA
