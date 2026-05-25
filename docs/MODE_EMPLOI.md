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
9. [Les Équipes — l'identité visuelle et la fiche enrichie](#9-les-équipes--lidentité-visuelle-et-la-fiche-enrichie)
10. [Les Sites — la mémoire vivante du lieu](#10-les-sites--la-mémoire-vivante-du-lieu)
11. [Les Contrats](#11-les-contrats)
12. [Les Appels d'Offres (AO) — votre wedge premium](#12-les-appels-doffres-ao--votre-wedge-premium)
13. [La Bibliothèque](#13-la-bibliothèque)
14. [Les Intervenants (manager + admin)](#14-les-intervenants-manager--admin)
15. [**Les Passages de témoin — le killer feature**](#15-les-passages-de-témoin--le-killer-feature)
16. [Le Dossier de preuves](#16-le-dossier-de-preuves)
17. [Le mode mobile chef d'équipe](#17-le-mode-mobile-chef-déquipe)
18. [Le bouton Feedback](#18-le-bouton-feedback)
19. [Administration (admin only)](#19-administration-admin-only)
20. [Doctrines à respecter pendant le pilote](#20-doctrines-à-respecter-pendant-le-pilote)
21. [Que faire si…](#21-que-faire-si)
22. [**Continuité opérationnelle anticipée**](#22-continuité-opérationnelle-anticipée)
23. [Le tableau de bord vivant](#23-le-tableau-de-bord-vivant)
24. [Importer par lot & tri d'ingestion](#24-importer-par-lot--tri-dingestion)
25. [Continuité des contrats (CDD, prolongation)](#25-continuité-des-contrats-cdd-prolongation)

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

> [!SUCCESS] La promesse
> Au bout de 6 mois, vous saurez sur n'importe quel site :
> - Ce qui s'y passe régulièrement
> - Ce qui revient comme problème
> - Qui le connaît déjà
> - Quelles preuves vous y avez accumulées
> - Ce que vous y avez promis dans le contrat
>
> Et tout ce capital sera **réutilisable** dès qu'un nouvel AO du même type arrive.

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

Le dashboard n'est **pas** un tableau de KPI. C'est une surface de **mémoire opérationnelle** : il « apparaît au bon moment, puis se retire ». Volontairement sobre, 4 zones seulement (mai 2026 — refonte « collapse éditorial »).

### Ce que vous y voyez (de haut en bas)

1. **Le bonjour** : prénom + nombre de contrats actifs.

2. **« Mémoire active ce matin »** (le bloc principal) : **un seul message** mis en avant (plus un secondaire au maximum), ou un **silence assumé**. Selon ce qui mérite votre attention, il affiche :
   - 🟢 *« Les lieux sont calmes ce matin »* (fond vert) quand rien ne presse — et c'est très bien ;
   - 🟠 une **passation à préparer / en attente de reconnaissance** (continuité) ;
   - une **échéance d'appel d'offres** proche ;
   - 🔴 un **signalement terrain** récent ;
   - une **résonance mémoire** (« ce que les lieux disent ce matin »).

3. **« Vie des lieux »** : un **flux unique, hiérarchisé**, regroupé en **familles colorées** (pas une liste plate) :
   - 🔴 **Attention opérationnelle** (rouge) : signalements terrain, anomalies ouvertes, engagements et contrats à surveiller ;
   - 🟠 **Continuité** (ambre) : passations reconnues / en attente ;
   - 🟣 **Appels d'offres** (violet) : échéances ;
   - 🔵 **Mémoire terrain** (bleu doux) : « à savoir » récents, silence inhabituel d'un site.
   Densité variable : un signal précis = une ligne normale ; un résumé (« 8 anomalies ouvertes ») = une ligne compacte.

4. **Pied de page** : *« Mémoire accumulée : X interventions documentées · Y preuves »* (votre capital, pas un KPI) + lien discret **« Préparer ma défense »** (mode litige).

Les KPI volumineux, le widget Pipeline AO et le widget « Contrats sous tension » ont été **retirés** : ces chiffres sont accessibles via le menu de gauche (Appels d'offres, Contrats, Sites…). Le dashboard **pointe** vers les pages spécialisées, il ne les recopie pas.

### D'où viennent ces signaux ?
Chaque signal de « Vie des lieux » est **calculé à partir de faits réels** (dates, statuts, comptages) — jamais inventé. Le système ne montre « silence inhabituel » que s'il y a vraiment une absence de trace, « passation reconnue » que si une reconnaissance a eu lieu, etc. Le sujet est **toujours le lieu ou l'équipe**, jamais une personne.

> [!TIP] Règle d'or
> **Silence positif** : un matin calme affiche peu de choses — c'est voulu. Le silence donne de la valeur aux moments où le système parle. On ne remplit jamais l'écran pour se rassurer.

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

> [!WARNING] Important
> **Pas de notion de « créneau »** dans MemorIA — uniquement des **heures réelles**. Une intervention à 6h30 est listée à 6h30, pas dans « Matin ».

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

## 9. Les Équipes — l'identité visuelle et la fiche enrichie

URL : `/equipes` (liste) → click sur le badge ou l'icône lien → `/equipes/[id]` (fiche)

### Ce que c'est
Une **équipe** = un conteneur logistique. Plusieurs chefs d'équipe + agents y sont rattachés. Une équipe a un nom, une **couleur + icône**, un référent, des spécialités déclarées.

### Doctrine importante
- L'identité visuelle (couleur + icône) est un **repère**, jamais une sémantique.
- L'effectif (nombre d'agents) est **descriptif**, jamais une métrique de performance.
- Aucune comparaison inter-équipes nulle part dans l'app.

### Sur la liste `/equipes` (admin + manager)
- **Bouton « Nouvelle équipe »** : nom + aperçu live 3 variantes + couleur (12 swatches sobres ou hex libre) + icône (18 pictogrammes : `spray-can`, `flower-2`, `shield-check`, `hospital`…)
- Pour chaque équipe en ligne :
  - 🎨 **Bouton palette** : modifier nom / couleur / icône à posteriori
  - 🔗 **Bouton lien** : ouvrir la fiche enrichie `/equipes/[id]`
  - 👥 **Bouton Éditer** : composition (ajouter / retirer des membres)
  - **Archive** : soft-delete (l'historique reste)

### La fiche équipe `/equipes/[id]` (admin + manager)
**Inspirée des fiches Site et Intervenant**. Centrée sur l'équipe comme entité opérationnelle.

1. **Header** : badge équipe (couleur + icône + nom), référent, ancienneté (« créée il y a 8 mois »), effectif descriptif.
2. **Spécialités déclarées** (édition inline) : 12 tags whitelistés (bio-nettoyage, vitrerie, vitres-hauteur, espaces-verts, hospitalier, bureaux, écoles, industriel, résidentiel, conciergerie, désinfection, monobrosse). Max 12 sélectionnés. **Servent au matcher AO.**
3. **5 compteurs descriptifs** :
   - Sites couverts
   - Contrats touchés
   - Interventions documentées
   - Photos déposées
   - Anomalies traitées
4. **Rythme — 14 derniers jours** : densité quotidienne avec tooltips
5. **Densité — 90 derniers jours** : heatmap calendrier (façon GitHub), 4 niveaux d'intensité descriptifs
6. **Sites favoris** (top 8 par fréquence) — cliquables
7. **Contrats touchés** (top 8) — cliquables
8. **Photos récentes** (8 dernières, thumbnails)
9. **Équipes voisines** : équipes qui partagent au moins un membre OU un site avec celle-ci (utiles pour back-up et passage de témoin)
10. **Composition actuelle** : membres + tag « Réf. »
11. **Activité récente** : 15 dernières interventions

**Rappel doctrine en pied** : *« Toutes les données affichées ici sont descriptives. Aucune comparaison inter-équipes, aucun classement, aucun score. »*

### Le mode contrasté pour impression papier
Le badge équipe a 3 variantes automatiques selon le contexte :
- **Coloré** (défaut) : sur dashboard et Semaine
- **Point compact** : dans les cellules denses
- **Monochrome** : pour impression N&B et daltoniens. Si tu imprimes ton planning et le distribues à un référent, **l'icône reste lisible sans la couleur**.

### Spécialité → matcher AO
Quand un AO arrive et qu'il parle de bio-nettoyage hospitalier, MemorIA peut proposer (dans le wizard de conversion AO → contrat) : *« 2 équipes connaissent cette spécialité : Équipe Magenta, Équipe Médipôle. »* Tu réutilises le capital de connaissance.

---

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

### Des engagements aux propositions opérationnelles
Dans l'Atelier, **« Extraire les engagements »** transforme l'AO en **propositions typées** — pas juste du texte. Chaque proposition cite **l'extrait source** exact (p. X · § Y) et reçoit une **destination suggérée** que **vous validez** :
- **Obligation contrat** → deviendra une *promesse* du contrat (planifiable, suivie en preuve).
- **Vigilance** → pénalité / point sensible → panneau **« Points de vigilance issus de l'AO »** sur le contrat.
- **À savoir** → savoir du lieu (accès, livraison…) → à **pousser vers un site** depuis le contrat → devient un « à savoir » de la mémoire du lieu.

> [!TIP] L'IA propose, vous validez
> Rien n'est publié automatiquement. Vous corrigez le type et la destination en curation avant que ça devienne un objet opérationnel.

À la **conversion en contrat**, les obligations deviennent les promesses ; vigilances et à savoir vont dans leurs surfaces dédiées.

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

### Ajouter des documents
Un seul bouton **« Ajouter des documents »** : dépose **1 ou plusieurs** PDF. Pour chacun, MemorIA propose un **type**, une **couche mémoire** et une **indexation** ; tu valides avant l'import. La création de **collection** se fait depuis la Bibliothèque (une collection = un tiroir de rangement).

> [!TIP] Doublons
> Si tu importes deux fois le même fichier, MemorIA le détecte (**« déjà là »**) et ne le duplique pas : il **réutilise** le document et ajoute simplement le nouveau rattachement.

### Indexation — SÉLECTIVE (plus « tout embeddé »)
Tous les documents ne méritent pas la mémoire active. Chaque doc affiche son état :
- 🟢 **Indexé** — embeddé, retrouvable par la recherche / les résonances (couches *vivante* et *consultable*).
- ❄️ **Non indexé** — couche *froide* : stocké, **pas d'embedding** (factures, archives). Zéro coût IA.
- *Indexation… / échouée* selon le pipeline.

### Rattachements (un doc, plusieurs liens)
Un document est **un seul nœud** mais peut être **rattaché à plusieurs entités** : Contrat, Site, Client, AO, Équipe. La liste et la fiche montrent « **Rattaché à : Contrat X · Site Z** ». Depuis la fiche, le bouton **« + rattacher »** ajoute un lien (ex. relier un CCTP à un client **et** un AO). Jamais de doublon de document.

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

## 15. Les Passages de témoin — le killer feature

URL : `/handovers` (liste) + `/handovers/[id]` (détail) + `/h/[token]` (URL publique partagée)

### Pourquoi c'est central
Quand Sandrine quitte ton équipe, **toute la mémoire qu'elle avait des sites qu'elle couvrait part avec elle dans sa tête**. Joseph qui la remplace lundi à 5h30 sur le CHT Magenta n'a aucune idée :
- Que le SAS B est en travaux et qu'il faut passer par le C après 19h
- Que le client Pascal préfère qu'on le prévienne par WhatsApp
- Qu'il y a eu 3 anomalies « produit manquant » en mars
- Qu'il existe un plan d'accès stocké avec le code badge
- Qu'une autre équipe (Beta) peut faire du back-up

**MemorIA compile tout ça en 2 secondes** dans un brief immuable et partageable.

### La page `/handovers` (vue d'ensemble vivante)
Même quand vous n'avez **aucun brief à transmettre**, la page n'est pas vide — elle montre que la continuité est suivie :
- **Bandeau d'état** : 🟢 *« Continuité stable — aucune passation urgente »* (avec la date du dernier témoin reconnu), ou 🟠 *« N passations à préparer cette semaine »* si des contrats se terminent.
- **Mémoire transmise ce mois-ci** : le **volume préservé** par les passations (sites couverts, « à savoir », anomalies relayées, documents, équipes relais). C'est un volume, **pas un score**.
- **Dernières passations** : une frise des derniers briefs (« reconnu par X · consulté 3 fois », « brief généré il y a 12 jours », « archivé »).
- **À savoir, en ce moment** : quelques consignes de site actuellement vivantes.

En dessous, les onglets habituels filtrent les briefs par statut (À transmettre / Partagé / Reconnu / Archivé).

### Deux types de briefs

#### Type 1 — Changement d'équipe
**Déclenché depuis** `/intervenants/[id]` → bouton **« Préparer un passage de témoin »**
**Manager + admin uniquement** (self exclu — une personne ne génère pas son propre brief)

Tu choisis :
- L'équipe d'origine de la personne (optionnel — sinon prend toutes ses équipes actives)
- L'équipe de destination (optionnel)

MemorIA compile un brief multi-sites focalisé sur ce que cette personne couvrait.

#### Type 2 — Prise de nouveau site
**Déclenché depuis** `/equipes/[id]` → bouton **« Brief pour une prise de site »**

Tu choisis :
- Le site que l'équipe va prendre

MemorIA compile un brief mono-site avec toute la mémoire accumulée par les équipes précédentes.

### Le contenu du brief
Pour chaque site concerné, MemorIA inclut :
- 📌 **À savoir** : consignes persistantes actives du site (8 max)
- 🚨 **Anomalies actives** : `status='open'` + 90 derniers jours uniquement (5 max). **Pas de bruit historique.**
- 📄 **Documents rattachés** : plans d'accès, codes badge, protocoles — sauf litiges (exclus automatiquement)
- 👥 **Équipes voisines** : qui d'autre connaît ce site, pour back-up (4 max)
- 🔢 **Compteurs** : nombre d'interventions documentées + dernière date

Plus une **zone de notes manager** que tu peux ajouter (« Pascal préfère WhatsApp »).

### Le partage public `/h/[token]`
1. Sur la page du brief, tu cliques **« Partager (URL publique) »**
2. Tu choisis la durée (1 à 60 jours)
3. MemorIA génère un **QR code** + une URL `https://memoria.exemple.fr/h/abc123xyz...`
4. Tu screenshotes le QR → tu l'envoies sur WhatsApp à Joseph
5. Joseph ouvre sur son téléphone **sans login**, lit le brief, clique **« C'est lu, j'ai compris »**
6. Côté admin, le brief bascule en « Reconnu » avec horodatage

Le QR et l'URL sont **mobile-first** — pensés pour être lus à 5h30 sous la lumière d'un parking.

### Le snapshot immuable
Une fois généré, le brief **fige son contenu**. Si tu le rouvres 6 mois plus tard, il montre **6 mois en arrière**, pas la version actuelle. C'est important pour :
- **Audit** : on peut prouver ce qui a été transmis à qui
- **Responsabilité** : qui savait quoi à quel moment
- **Continuité** : la mémoire transmise ne se réécrit pas

Seules les **notes manager** restent éditables. Le reste est figé.

### La mémoire qui vieillit
Si Joseph reçoit un brief avec 38 anomalies dont 80% sont anciennes, MemorIA devient anxiogène. Donc :

- ✅ Les anomalies **résolues** n'apparaissent plus dans les briefs (un manager peut résoudre une anomalie **directement depuis le brief** via le bouton « Résoudre »)
- ✅ Les anomalies **plus de 90 jours** sont automatiquement exclues
- ✅ Chaque anomalie affiche son âge en clair (« il y a 3 jours », « il y a 2 mois »)

### Cycle de vie d'un brief
```
À transmettre → Partagé → Reconnu → Archivé
```
4 onglets sur `/handovers` avec compteurs.

### Doctrine stricte
Le brief documente **LES SITES** et la mémoire utile à transmettre. **JAMAIS** la personne qui s'en va.

| ✅ Autorisé | ❌ Interdit |
|---|---|
| « 3 sites concernés » | « Évaluation de la personne » |
| « Voici les À savoir » | « Pourquoi elle part » |
| « Anomalies actives » | « Sa performance passée » |
| « Équipes voisines pour back-up » | « Sa note de fin de contrat » |

---

## 16. Le Dossier de preuves

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

## 17. Le mode mobile chef d'équipe

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

## 18. Le bouton Feedback

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

## 19. Administration (admin only)

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

## 20. Doctrines à respecter pendant le pilote

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

## 21. Que faire si…

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

## 22. Continuité opérationnelle anticipée

URL : `/continuite` (admin + manager, gated par variable ENV)

### Pourquoi cette page
Quand un CDD se termine et que personne n'a préparé la passation, la mémoire opérationnelle portée par cette personne disparaît avec elle. Joseph arrive sur le site CHT Magenta sans rien savoir des consignes, des anomalies récentes, des contacts client. C'est exactement le scénario que MemorIA cherche à éviter.

La page `/continuite` te montre, **en amont**, qui a un contrat se terminant dans les 30 prochains jours, et quelle mémoire opérationnelle est portée par cette personne. Tu peux préparer le passage de témoin **avant** qu'il soit trop tard.

### La saisie de la date de fin de contrat
Sur la fiche d'un intervenant (`/intervenants/[id]`), tu vois un encadré « Contrat se termine le… » avec un bouton « Modifier ». Tu saisis la date — c'est tout. Cette date sert **uniquement** à déclencher l'apparition de cette personne dans `/continuite`.

### Trois sections temporelles
La page `/continuite` est organisée en 3 sections **par ordre de proximité** :

1. **Cette semaine (≤ 7 jours)** — bordure rose, urgent
2. **Dans 2 semaines (8-14 jours)** — bordure ambre, vigilance
3. **Dans 1 mois (15-30 jours)** — bordure neutre, à anticiper

Pour chaque entrée, tu vois :
- Le **nom** de la personne (cliquable vers sa fiche)
- Le **type de contrat** (CDD / CDI Chantier)
- La **date exacte** de fin
- Le **nombre de sites** que cette personne couvre actuellement (via ses équipes)
- Les **équipes actives** dont elle fait partie
- Un badge ✅ « Brief préparé » si un brief de passage de témoin a déjà été créé pour elle
- Un bouton « Préparer la passation » qui te ramène sur sa fiche pour générer le brief

### Le sujet est toujours la mémoire, jamais la personne

| ✅ Ce que la page dit | ❌ Ce qu'elle ne dit JAMAIS |
|---|---|
| « 3 sites portent une mémoire opérationnelle » | « Joseph est critique » |
| « Contrat se termine le 14 juin » | « Risque de départ » |
| « Préparer la passation avant le 14 juin ? » | « Préparer le remplacement de Joseph » |
| « 5 équipes voisines connaissent ces sites » | « Cette personne est-elle remplaçable ? » |

C'est pour ça qu'on parle de **continuité de mémoire opérationnelle**, pas de **gestion RH**.

### Garde-fous techniques
- **Kill switch** : variable ENV `CONTINUITY_PAGE_ENABLED=false` → la page renvoie 404. Si tu signales un malaise lors du pilote, on coupe en 1 minute.
- **Self-exclu** : une personne **ne voit jamais sa propre fin de contrat** dans `/continuite`. C'est un objet manager, pas un dossier personnel.
- **Audit log** : chaque consultation est tracée (qui a regardé, quand).
- **Tripwires CI** : le code refuse au build toute fonction qui ressemble à de la prédiction de départ (`departureRisk`, `criticalAgent`, `replacementScore`…).
- **Pas de score, pas de classement, aucune comparaison entre personnes.**

### Sur le tableau de bord
Depuis la refonte « collapse », il n'y a plus d'encart séparé : la continuité remonte directement dans le bloc **« Mémoire active ce matin »**. S'il y a une passation urgente à préparer (contrat finissant ≤ 7 jours), le bandeau passe en ambre avec un lien vers `/continuite`. Sinon, il affiche *« Continuité stable »*. **Silence positif** : rien d'urgent → aucun bruit.

### Comment l'utiliser au quotidien
1. **Tu renseignes les dates de fin de contrat** sur les fiches Intervenants (pour les CDD et CDI Chantier de ton équipe).
2. **MemorIA fait apparaître l'entrée** dans `/continuite` quand on entre dans les 30 jours.
3. **Tu cliques « Préparer la passation »** → tu génères un brief de passage de témoin classique (section 15).
4. **Tu envoies le QR code au chef d'équipe successeur** sur WhatsApp.
5. **Le chef successeur consulte** sans login, marque « C'est lu », et tu sais côté MemorIA que la transmission a abouti.

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

## 23. Le tableau de bord vivant

Le tableau de bord ne cherche pas à tout afficher — il **apparaît au bon moment puis se retire**. Trois condensations du moteur de mémoire :

- **État de la continuité** — une synthèse sobre du parc (stable / passations en attente / silences).
- **Temps mémoriel** — un petit calendrier où chaque jour prend la couleur de ce que la mémoire a fait : vert = continuité confirmée, ambre = transmission, bleu = mémoire récente. Pas un graphique d'activité — une respiration.
- **Dernière mémoire utile** — le fil des derniers artefacts (« à savoir », passations reconnues, signalements).

Puis **Vie des lieux** : les lieux qui méritent attention remontent ; les calmes restent discrets.

> [!TIP] Règle d'or
> Un tableau de bord calme est un bon signe. Le silence donne de la valeur aux moments où le système parle.

---

## 24. Importer par lot & tri d'ingestion

URL : `/documents` → bouton **Importer par lot**.

L'idée centrale : **tous les documents ne méritent pas la mémoire active.** Vos plans, procédures et comptes-rendus dorment souvent dans des dossiers — MemorIA les transforme en mémoire utile, **sans tout vectoriser aveuglément**.

> [!IMPORTANT] Le principe
> Pour chaque document, la question n'est pas « peut-on l'indexer ? » mais **« nourrit-il la mémoire vivante ? »**.

**Les 3 couches mémoire :**
- 🟢 **Vivante** — procédures, accès, sécurité : mémoire opérationnelle.
- 🔵 **Consultable** — contrats, AO, références : indexés pour la recherche.
- ❄️ **Froide** — factures, preuves : stockées, **non indexées**.

**Le tableau de triage** : déposez plusieurs PDF. Pour chacun, MemorIA propose un **type**, une **couche** (dérivée du type), une **indexation** (oui/non) et **pourquoi**. Vous changez le type ou l'indexation si besoin — **rien n'est importé tant que vous ne validez pas**. L'import se fait par petits paquets ; si un fichier échoue, les autres passent quand même.

> [!WARNING] Litige
> Un document de type **litige n'est jamais indexé** automatiquement — verrouillé à l'écran **et** côté serveur.

---

## 25. Continuité des contrats (CDD, prolongation)

Quand vous créez un intervenant en **CDD** ou **CDI Chantier**, MemorIA exige **la date de fin de contrat**. Cette date alimente la continuité :

- **Tableau de bord** & **Passages de témoin** : un encart « N passations à préparer » apparaît **si** une fin approche (≤ 30 jours), avec le détail par échéance. Silence si rien.
- **Fiche intervenant** : bouton **« Prolonger »** — un CDD renouvelé (même agent ou non) = nouvelle date de fin. Sinon la passation reste à préparer.

> [!TIP] Doctrine
> Le sujet reste **la passation de mémoire**, jamais la personne. MemorIA n'évalue pas un agent ; il évite qu'un savoir parte avec lui.

---

**Le pilote dure 30 jours.** À la fin :
- Si Guillaume utilise activement /aujourdhui et /semaine
- Si au moins 50 interventions ont été documentées
- Si au moins 5 anomalies ont été traitées via MemorIA
- Si aucune doctrine n'a été cassée hors-UI

… le pilote est un succès. On peut alors basculer en production réelle et étendre à d'autres équipes.

**Bon pilote.**

— L'équipe MemorIA
