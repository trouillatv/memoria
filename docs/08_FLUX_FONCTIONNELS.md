# Flux fonctionnels

Les parcours utilisateur principaux de bout en bout.

---

## 1. Réponse à un AO → Contrat

```
Manager crée un AO (/tenders/new)
  → Upload PDF document
  → POST /api/tenders/[id]/analyze
  → Poll /api/tenders/[id]/status (2s)
  → Analyse IA complète (synthèse, contraintes, risques, mémoire technique)
  → Sidebar débloquée : Atelier IA disponible

Manager ouvre l'Atelier IA
  → Sélectionne un ou plusieurs agents
  → Chat multi-tours avec contexte AO + bibliothèque
  → Export PDF si contenu IA

Manager passe aux Engagements
  → Extrait les engagements par IA (extractEngagementsAction)
  → Cure : édite labels, rejette les non pertinents, archive avec motif
  → Peut ajouter des engagements manuels

Manager crée le contrat (/tenders/[id]/convert)
  → Engagements curated → active automatiquement
  → Contrat lié à l'AO
```

---

## 2. Planification terrain (semaine)

```
Manager ouvre /semaine (vue grille)
  → Colonne par équipe, ligne par jour
  → Fait glisser une mission dans une cellule → crée une intervention
  → Ou clique sur + dans une cellule → dialog création intervention
  → Peut réaffecter l'équipe d'une intervention existante

Manager consulte /briefing?date=YYYY-MM-DD
  → Génération automatique : interventions du jour par site + équipes + créneaux
  → Lit les notes de site actives
  → Partage WhatsApp (mobile: navigator.share, desktop: whatsapp:// + clipboard)
```

---

## 3. Exécution terrain (chef d'équipe)

```
Chef d'équipe ouvre /preparation
  → Voit ses interventions du jour avec infos site et équipe

Chef d'équipe ouvre /m/intervention/[id] (mobile)
  → Lit la checklist (items liés aux engagements)
  → Coche les items au fur et à mesure
  → Signale une anomalie (catégorie + description + photo optionnelle)
  → Prend des photos avant/après/preuve
  → Saisit les participants présents
  → Passe l'intervention en "completed"

Manager valide depuis /interventions/[id]
  → Vérifie photos et checklist
  → Marque "validated"
  → Intervention disponible dans /preuves
```

---

## 4. Récurrence d'interventions

```
Manager crée un template de récurrence sur une mission
  → Choisit : frequency (daily/weekdays/weekly/monthly/one_shot)
  → Choisit slots (morning/afternoon/evening)
  → Définit starts_on et ends_on optionnel

Chaque consultation de la vue semaine ou du briefing
  → Déclenche génération paresseuse à 7j glissants
  → Seules les interventions dans la fenêtre +7j sont créées
  → Pas de pré-génération massive
```

---

## 5. Preuve & Litige

```
Parcours preuve standard :
  Manager ouvre /preuves
  → Filtre par contrat / date
  → Ouvre une intervention validée → fiche preuve
  → Génère dossier PDF (route /preuves/[id]/dossier)
  → Partage via token signé (lien public /p/[token])
  → Clôture le dossier (irréversible)

Parcours litige express (<30s) :
  Manager ouvre /litige
  → Sélectionne contrat + période
  → Niveau de confiance calculé automatiquement
  → Génère dossier PDF multi-interventions
  → Partage lien immédiatement
```

---

## 6. Compliance engagements

```
Contrat actif avec engagements active
  ↓
  Missions liées aux engagements via engagement_ids[]
  ↓
  Interventions exécutées sur ces missions
  ↓
  Photos + checklist + anomalies = preuves d'exécution
  ↓
  Tableau compliance /contracts/[id] (onglet Engagement compliance)
    → Colonnes : promised / planned / executed / proven / validated
    → Calcul ratio 0-1 par engagement
  ↓
  Dashboard "Engagements à risque" = active sans exécution récente
```

---

## 7. Administration utilisateurs

```
Admin ouvre /admin/users
  → Liste tous les users (non supprimés)

Création user :
  → Mode invite : email Supabase → user définit son mdp
  → Mode temp password : compte créé avec mdp temporaire → must_change_password = true

Gestion :
  → Changement de rôle (loggué dans audit_log)
  → Reset mot de passe forcé (remet temp password + must_change_password)
  → Édition téléphone E.164 (pour WhatsApp 1-à-1)
  → Suppression douce (soft delete, user ne peut plus se connecter)
```

---

## 8. Monitoring admin (en développement)

```
Admin ouvre /admin/monitoring
  → Sélecteur période : 7j / 30j / 90j

Onglet Adoption :
  → Tableau users : dernière connexion, nb actions, statut (actif/dormant/inactif)
  → Compteurs actions : interventions créées/clôturées, photos, anomalies, validations
  → Feed activité : audit_log dernières 100 entrées avec nom user

Onglet Santé opérationnelle :
  → KPI cards : taux clôture, couverture preuves, anomalies ouvertes,
                 engagements sans mission, interventions en retard
  → Tableau par contrat : taux clôture trié croissant
  → Alertes si seuils dépassés
```
