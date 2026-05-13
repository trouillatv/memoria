# Spécifications fonctionnelles

## Auth

- **Login** (`/login`) : email + mot de passe, redirection post-login vers `/dashboard`
- **Invitation** (`/accept-invite`) : lien email Supabase, définition mot de passe initial
- **Changement de mot de passe** (`/change-password`) : forcé si `must_change_password = true`
- **Mot de passe temporaire** : admin peut réinitialiser → `must_change_password` activé

---

## Appels d'offres (`/tenders`)

### Création et analyse
- Création d'un AO avec titre, client, deadline
- Upload document (PDF) → extraction texte côté serveur
- Analyse IA asynchrone (poll `/api/tenders/[id]/status`) → synthèse, contraintes, risques, checklist, mémoire technique
- Sidebar : Synthèse / Analyse détaillée / Mémoire technique / Atelier IA / Engagements

### Atelier IA
- Chat multi-agents : 7 agents sélectionnables (lecteur_ao, memoire_technique, contradicteur, financier, terrain, conformite, general)
- Génération des analyses d'agents en parallèle
- Export PDF "Atelier IA → Dossier de préparation" (visible uniquement si contenu IA existe)

### Mémoire commerciale
- Statut sortie : won / lost / withdrawn / not_responded + raison + tag (prix/qualité/relation/timing/autre)
- Rappel contextuel AO similaires sur la fiche AO
- Note vocale DG (enregistrement navigateur, stockée dans bucket `tender-voice-notes`)
- Journal mémoire (`/tenders/memoire`) : historique des AO avec filtres

### Engagements
- Extraction IA des engagements depuis le texte AO + mémoire technique
- Curation manuelle : édition label/catégorie, archivage avec motif, ajout manuel
- Cycle de vie : `extracted` → `curated` → `active` → `completed` / `archived`
- Suppression (reject) possible en phase extracted/curated uniquement
- Archive avec motif obligatoire si des interventions sont déjà liées

### Création de contrat
- Formulaire : nom, client, date début/fin
- Active automatiquement les engagements curated → `active`

---

## Dashboard (`/dashboard`)

Cockpit manager. Widgets :
- **Pulse semaine** : interventions planifiées / réalisées / en retard
- **Capital preuves** : photos remontées, taux de validation
- **Pipeline AO** : AO en cours par statut
- **Anomalies ouvertes** : par criticité
- **Engagements à risque** : engagements actifs sans couverture récente
- **Contrats sous tension** : taux de clôture < seuil
- **Activité récente** : feed des dernières actions
- **Stats cumulées tenant** : totaux depuis le début

---

## Missions (`/missions`)

Vue globale des missions actives cross-contrats. Liste avec statut, site, contrat, cadence.

---

## Vue Semaine (`/semaine`)

Grille glisser-déposer : équipes en colonnes × jours en lignes.
- Affectation d'interventions aux équipes par drag & drop
- Création d'intervention à la volée depuis une cellule
- Réaffectation d'équipe depuis la cellule
- Interventions passées en gris hachuré
- Export semaine

---

## Fiche Contrat (`/contracts/[id]`)

Onglets :
- **Sites** : liste des sites du contrat, création
- **Missions** : missions liées, création, édition (avec récurrence)
- **Interventions** : liste filtrée, création inline
- **Engagement compliance** : tableau des engagements avec ratios planned/executed/proven/validated
- **Rapport mensuel** : édition et partage du rapport client

### Récurrence d'interventions
5 patterns : daily, weekdays, weekly, monthly, one_shot
Génération paresseuse à 7 jours glissants (pas de pré-génération massive)

---

## Briefing (`/briefing`)

Généré pour une date donnée. Contenu :
- Nombre d'interventions, équipes mobilisées
- Détail par site : nom site, équipes affectées, créneau (matin/après-midi/soir)
- Notes site actives

Partage WhatsApp :
- Mobile : `navigator.share()`
- Desktop : `whatsapp://send?text=...` + copie clipboard fallback

---

## Intervention terrain (`/m/intervention/[id]`)

Vue mobile chef d'équipe :
- Panneau exécution : checklist, notes
- Panneau anomalies : signalement (catégorie + description), résolution
- Panneau participants : membres présents
- Panneau validation : signature manager
- Skip (avec motif obligatoire)

---

## Preuves (`/preuves`)

- Liste des interventions completed/validated avec filtres date, client, contrat
- Fiche preuve (`/preuves/[id]`) : photos, anomalies, checklist, validations
- Dossier PDF avec QR code de vérification
- Partage public via token (`/p/[token]`)
- Clôture du dossier (irréversible, avec archivage)

---

## Mode Litige (`/litige`)

Wizard en 3 étapes :
1. Sélection contrat + période
2. Niveau de confiance calculé (photos, validations, anomalies résolues)
3. Génération dossier PDF + lien de partage

---

## Bibliothèque (`/library`)

Base de connaissances interne :
- Catégories : références clients, moyens humains, matériel, procédures, qualité, anciens mémoires
- Vue liste / carte
- Tags libres
- Utilisée comme contexte IA pour les analyses AO

---

## Équipes (`/equipes`)

- Création / archivage d'équipes (nom + couleur)
- Composition (membres) modifiable dans le temps
- Référent d'équipe (point de contact opérationnel)
- Historique des membres (left_at conservé)

---

## Sites (`/sites`)

- Vue globale cross-contrats de tous les sites actifs
- Fiche site : adresse, code accès, code alarme, contact, horaires, instructions
- Notes de site (140 chars max, vivantes, Doctrine V5 verrou V4)

---

## Administration (`/admin`)

### Utilisateurs (`/admin/users`)
- Création (invite email ou mot de passe temporaire)
- Changement de rôle
- Reset mot de passe forcé
- Suppression douce (soft delete)
- Édition téléphone (format E.164)

### Monitoring (`/admin/monitoring`)
- Onglet **Adoption** : tableau users (dernière connexion, activité), répartition des actions, feed d'activité
- Onglet **Santé opérationnelle** : KPIs clôture/preuves/anomalies, tableau par contrat, alertes
- Période sélectionnable : 7j / 30j / 90j

---

## Préparation chefs d'équipe (`/preparation`)

Vue dédiée aux chefs d'équipe : leurs interventions du jour avec informations site et équipe. WhatsApp 1-à-1 avec chaque chef.
