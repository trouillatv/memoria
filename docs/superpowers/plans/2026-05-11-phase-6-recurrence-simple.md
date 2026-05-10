# Phase 6 — Récurrence simple

> Plan d'implémentation. À exécuter via subagent-driven-development après merge de `feat/cross-tender-matching`.

**Goal :** Modéliser la répétition des interventions (la majorité du quotidien cleaning) sans devenir ERP. 5 patterns simples. Génération paresseuse. Zéro assignation d'agent.

**Doctrine :** Le planning sert la preuve, pas la gestion des humains. Cf. `docs/superpowers/doctrines/planning-doctrine.md`.

**Prérequis :** Merge `feat/cross-tender-matching` vers `main` avant de commencer Phase 6.

---

## 1. Data model (minimal)

### Chaîne doctrinale immuable

```
Engagement (promesse contractuelle)
    ↓
Mission (recette opérationnelle stable)
    ↓
Intervention (instance datée exécutable)
    ↓
Preuve
```

**Correction validée 2026-05-11 :** la récurrence ne bypass JAMAIS Mission. Tout template est attaché à une mission existante (ou crée une mission). L'intervention générée porte à la fois `template_id` ET `mission_id`. Le cockpit Boucle de preuve continue de raisonner par Mission, pas par template.

### Nouvelle table : `intervention_templates`

```
id              uuid pk
mission_id      uuid fk missions NOT NULL    -- chaîne doctrinale : template appartient à une mission
title           text                          -- "Bionettoyage sanitaires RDC, 2x/jour"
                                              -- (peut différer du titre de la mission si besoin)
description     text nullable                 -- libellé long
frequency       enum('daily','weekdays','weekly','monthly','one_shot')
slots           text[] nullable               -- orthogonal à frequency : ['morning'] | ['morning','afternoon']
day_of_week     smallint nullable             -- 1-7, applicable si frequency='weekly'
day_of_month    smallint nullable             -- 1-31, applicable si frequency='monthly'
starts_on       date                          -- début génération
ends_on         date nullable                 -- fin éventuelle (sinon = end_date de la mission/contrat)
active          bool default true
created_at      timestamptz
created_by      uuid fk users
deleted_at      timestamptz nullable
```

Note : `contract_id` et `site_id` ne sont PAS sur le template — ils sont dérivés via `mission_id → mission.site_id → site.contract_id`. Pas de duplication, pas de risque d'incohérence.

### Extension de `interventions` (existante)

```
+ template_id     uuid fk intervention_templates nullable
+ scheduled_for   date
+ slot            text nullable        -- 'morning' | 'afternoon' | 'evening' | null
+ skipped_at      timestamptz nullable
+ skipped_reason  text nullable
+ skipped_by      uuid fk users nullable

-- mission_id existe déjà sur interventions ; les interventions générées par template
-- portent template_id ET mission_id (= template.mission_id)

UNIQUE (template_id, scheduled_for, slot) WHERE template_id IS NOT NULL
```

### RLS

- admin, manager : CRUD sur les templates de leur tenant
- chef_equipe : lecture seule sur templates des sites où il a une mission active

### Champs interdits (rappel doctrine)

`assigned_to`, `agent_id`, `shift_start`, `shift_end`, `rotation_policy`, `coverage_rules`, `availability`, `cost_per_hour`, `holidays_calendar`.

---

## 2. Slices

### Slice 6.0 — Migration DB
- Migration 021 : table + colonnes + UNIQUE partial + RLS policies
- Tests DB minimaux : insert template, lecture par chef_equipe, contrainte UNIQUE déclenche bien
- Doc : commentaire SQL sur chaque colonne pour expliquer l'intention

### Slice 6.1 — Helpers DB
- `listTemplatesForContract(contractId)`
- `listTemplatesForSite(siteId)`
- `createTemplate(input)` / `updateTemplate(id, input)` / `archiveTemplate(id)`
- `generateInterventionsFromTemplates(siteId, fromDate, toDate)` — idempotent, skip dates déjà skipped, max range 7 jours
- `markInterventionSkipped(interventionId, reason)`
- Tests unitaires : 4 patterns générés correctement, idempotence, skip ne régénère pas

### Slice 6.2 — UX création récurrence (depuis une mission)
- Le bouton **+ Ajouter une récurrence** apparaît sur la page d'une mission (`/missions/[id]` ou cockpit mission équivalent), pas sur le contrat
- Modal : 4 questions, dans cet ordre, en français parlé
  1. **Quelle mission ?** — préremplie depuis le contexte (si on vient d'une page mission). Sinon dropdown des missions actives du contrat.
  2. **Elle revient quand ?** (radio) — Tous les jours / Lundi-vendredi / Une fois par semaine / Une fois par mois
     - Si "une fois par semaine" → champ secondaire **Quel jour ?** (Lundi → Dimanche)
     - Si "une fois par mois" → champ secondaire **Quel quantième ?** (1 à 28 + "dernier jour")
  3. **À quel moment de la journée ?** (chips multi-select, orthogonal à fréquence) — Matin / Après-midi / Soir
  4. **À partir de quand ?** (date picker, default = aujourd'hui)
- Le `title` du template est dérivé de la mission par défaut (modifiable si besoin)
- Validation client + serveur cohérente
- Pas de preview calendrier, pas de "next 5 occurrences", pas d'éditeur RRULE
- Création en <60 secondes (critère de réussite)

### Slice 6.3 — Génération paresseuse
- Edge function Supabase ou cron job nocturne à 02h00 : pour chaque template actif, génère les interventions des **7 prochains jours**
- Fallback : génération à la consultation `/m/missions?date=today` si un template actif n'a pas encore son intervention du jour
- Idempotent strict (UNIQUE constraint)
- Limite dure : jamais > 7 jours d'avance générés (sécurité anti-explosion DB)

### Slice 6.4 — UX "Pas aujourd'hui" (mobile et superviseur)
- Sur la liste d'interventions du jour (`/m/missions` et `/missions`), bouton sobre **"Pas aujourd'hui"** à côté de chaque intervention non commencée
- Modal : champ raison libre (text, requis) + bouton **Confirmer**
- L'intervention reste visible, grisée, avec badge "Sautée : <raison>"
- Pas de mass-skip ("skipper toute la semaine") — un skip par jour, à la main, pour forcer le geste conscient
- L'audit log enregistre `skipped_by` + `reason`

### Slice 6.5 — Vue superviseur "Récurrences" (depuis la mission)
- Sur la page d'une mission, section **Récurrences** qui liste les templates attachés à cette mission
- Liste plate (pas calendrier) :
  - Fréquence en français ("Lundi-vendredi", "Tous les 1er du mois")
  - Créneaux ("Matin + Après-midi")
  - Date de début
  - Dernière exécution (date + statut résumé)
  - Prochaine exécution prévue
- Actions par ligne : **Éditer** / **Archiver**
- Optionnel — dans `/contracts/[id]`, un widget "Récurrences actives" (compteur + lien vers les missions concernées) pour la lisibilité macro
- Aucun drag&drop, aucune réorganisation, aucune vue calendrier

### Slice 6.6 — Polish démo + smoke test
- Seed : ajouter 3-5 templates récurrents par contrat démo (CHU/Banque/École/Sainte-Marie)
- Smoke script : génère 14 jours, vérifie l'idempotence et la cohérence des comptes
- Doc note dans `docs/superpowers/notes/`

---

## 3. UX — Principes durs

- **Vocabulaire métier, pas technique.** "Cette mission revient quand ?", pas "Configurer la règle de planification".
- **Phrase complète française** dans la fréquence ("Tous les jours", "Tous les mardis"), pas "weekly day_of_week=2".
- **Créneaux nommés.** Pas d'heures précises (pas de "08h00-12h00"). Matin / Après-midi / Soir.
- **Liste, jamais calendrier.** La vue superviseur est une liste plate. Aucun composant Gantt, aucune grille hebdo Outlook-like.
- **"Pas aujourd'hui" sobre.** Pas "Annuler" (destructif), pas "Reporter" (suggère replanification automatique).
- **Génération invisible.** Le superviseur ne pense pas à "générer la semaine". Ça se fait tout seul.

---

## 4. Risques de dérive ERP — à surveiller par slice

À chaque PR de Phase 6, vérifier qu'on n'a PAS introduit :

| Signal | Niveau |
|---|---|
| Champ `assigned_to` ou `agent_id` sur template ou intervention | ROUGE — STOP |
| Composant `<Calendar>`, `<Gantt>`, `<WeekView>` | ROUGE — STOP |
| Concept `shift` / `vacation` / `rotation` / `roulement` | ROUGE — STOP |
| Mass-edit "skip tous les fériés" / "skip toute la semaine" | ROUGE — STOP |
| Bouton "Notifier l'agent" / "Envoyer SMS" | ROUGE — STOP |
| Champ `cost_per_hour` / `budget_hours` / `billable_minutes` | ROUGE — STOP |
| Vue "optimisation de tournée" / "trajet optimal" | ROUGE — STOP |
| Score "taux de réalisation par agent" | ROUGE — STOP |
| Notion de "remplaçant" / "remplacement" | ROUGE — STOP |
| Table `holidays` / `holiday_dates` | ROUGE — STOP |

**Test ultime à appliquer en revue :** Le système peut-il répondre à "qui est en retard ?" Si oui → on a dérivé. On doit pouvoir dire "telle preuve manque sur tel site", jamais "telle personne est en retard".

---

## 5. Garde-fous techniques

- **UNIQUE constraint** `(template_id, scheduled_for, slot)` non négociable — la génération paresseuse en dépend pour son idempotence.
- **Max 7 jours d'avance** — limite dure dans le helper de génération. Empêche les bases qui explosent et force la psychologie "ça se fait au fil de l'eau".
- **Skip individuel uniquement** — un appel = un skip d'une intervention. Pas de "skip range".
- **Anonymisation** — la liste superviseur affiche l'intervention, pas l'agent. `executed_by` reste en DB mais n'apparaît pas dans la vue Récurrences.
- **Pas de génération récursive de N missions** — la génération ne crée pas de missions (concept existant). Elle crée des interventions rattachées à une mission existante (à clarifier en Slice 6.0 selon le modèle actuel) OU directement attachées au site/template selon l'arbitrage à faire.
- **Soft-delete** — `deleted_at` sur templates. La désactivation ne supprime pas l'historique des interventions générées.

---

## 6. Critères de réussite (acceptation)

1. Un superviseur crée une mission récurrente en **moins de 60 secondes**, sans aide.
2. Le système génère les interventions des 7 prochains jours **sans intervention humaine**.
3. Sur `/m/missions`, les missions du jour incluent automatiquement les récurrences du template.
4. "Pas aujourd'hui" fonctionne avec raison libre, trace enregistrée.
5. Aucun champ `assigned_to` ou `agent_id` n'apparaît dans le diff total de Phase 6.
6. Aucun composant calendrier visuel n'apparaît dans l'UI.
7. La vue Récurrences reste une LISTE.
8. Les 5 patterns sont couverts, pas plus, pas moins.
9. Tests vitest : 100% des nouveaux helpers couverts. Suite totale verte.
10. Smoke script confirme l'idempotence sur 2 runs consécutifs.

---

## 7. Non-goals (explicites)

- ❌ RRULE complète (RFC 5545)
- ❌ Gestion des jours fériés (calendrier national, vacances scolaires)
- ❌ Assignation d'agent à une intervention ou un template
- ❌ Calendrier visuel (Gantt, vue hebdo, vue mensuelle)
- ❌ Notification automatique (SMS, push, email à l'agent)
- ❌ Optimisation de tournée / trajet optimal
- ❌ Rotation d'équipes
- ❌ Remplacement automatique en cas d'absence
- ❌ Gestion d'absence / congés / arrêts maladie
- ❌ Export "planning prévisionnel pour impression"
- ❌ Tarification horaire / coût main d'œuvre
- ❌ Score de réalisation par agent / par équipe
- ❌ Mass-edit ("skip tout le mois")

---

## 8. Décisions à trancher avant Slice 6.0

Trois points à valider en revue :

**Décisions tranchées le 2026-05-11 par l'utilisateur :**

1. **Mission existante vs intervention rattachée directe.** ✅ Tranché : **on garde Mission**. Le template est attaché à une mission via `mission_id NOT NULL`. L'intervention générée porte `template_id` ET `mission_id` (hérité du template). Pas de bypass de la chaîne Engagement → Mission → Intervention → Preuve.

2. **Cron Supabase vs lazy à la consultation.** ✅ Tranché : **les deux**, mais commencer par lazy only si cron ajoute friction. Priorité robuste & simple > architecture parfaite. UNIQUE constraint garantit l'idempotence quel que soit le déclencheur.

3. **`slots` orthogonal à `frequency`.** ✅ Tranché : **orthogonaux**. `frequency` et `slots` sont deux dimensions indépendantes. Mais en UX, jamais montrer la logique technique — on demande "Cette mission revient quand ?" puis "À quel moment de la journée ?".

---

## 9. Séquence d'exécution proposée

```
Slice 6.0 — Migration DB                  (1 subagent, ~30 min)
   ↓
Slice 6.1 — Helpers DB + tests            (1 subagent, ~45 min)
   ↓
Slice 6.2 — UX création template           (1 subagent, ~45 min)
   ↓
Slice 6.3 — Génération paresseuse          (1 subagent, ~30 min)
   ↓
Slice 6.4 — UX "Pas aujourd'hui"           (1 subagent, ~30 min)
   ↓
Slice 6.5 — Vue Récurrences superviseur    (1 subagent, ~45 min)
   ↓
Slice 6.6 — Polish démo + smoke            (1 subagent, ~30 min)
```

Total estimé : ~4 heures de travail subagent + revues. Branche : `feat/recurrence-simple`.

Après Phase 6 : test terrain Phase 3 mobile sur 3 agents réels avec récurrences activées sur leurs vrais sites. **Avant** Phase 5 Dossier de preuves.
