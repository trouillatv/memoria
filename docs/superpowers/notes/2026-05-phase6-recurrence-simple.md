# Phase 6 — Récurrence simple

**Date** : 2026-05-11 (closed)
**Branche** : feat/recurrence-simple

## Quoi

Les missions cleaning sont répétitives par nature (quotidien, lundi-vendredi, 2x/jour…).
Phase 6 modélise cette répétition via un système de **templates de récurrence** attachés
à une mission, sans devenir un ERP de planning.

## Pourquoi

Sans récurrence, le pilote terrain Phase 3 mobile reste artificiel : on crée des
interventions one-shot, mais le vrai quotidien du nettoyage est la répétition. La
récurrence sert la production de preuves, pas la gestion humaine.

## Stack

- Table `intervention_templates` (Slice 6.0) — attachée à une mission via `mission_id NOT NULL`
- 5 patterns : daily / weekdays / weekly / monthly / one_shot
- `slots` orthogonal à `frequency` (créneaux nommés : morning / afternoon / evening)
- Génération paresseuse via `generateInterventionsFromTemplates` (cap 7 jours, idempotente via UNIQUE)
- Lazy generation au boot de `/m/missions` et `/missions` superviseur (Slice 6.3) — pas de cron
- UX : modal 4 questions ("Elle revient quand ?" / "Quel jour ?" / "À quel moment ?" / "À partir de quand ?")
- "Pas aujourd'hui" : skip individuel avec raison libre obligatoire (Slice 6.4)
- Vue Récurrences enrichie : dernière intervention / prochaine / cette semaine + Éditer / Archiver (Slice 6.5)

## Doctrine respectée

- Aucun champ `assigned_to`, `agent_id`, `shift`, `rotation`, `holidays_calendar`
- Pas de calendrier visuel (vue = LISTE plate)
- Pas de RRULE complète, pas de jours fériés
- Pas de mass-skip
- Chaîne immuable Engagement → Mission → Intervention → Preuve préservée
- Anonymisation : les stats sont par récurrence/template, jamais par agent

## Décisions

- **Mission_id NOT NULL** sur template : la récurrence ne bypass jamais Mission
- **Lazy only** pour V1 : cron Supabase à ajouter plus tard si besoin
- **default_team hérité** de la mission par les interventions générées (champ pré-existant 018)
- **Archive = soft-delete**, jamais hard-delete depuis l'UI
- **Modifier un template ne supprime pas les interventions générées** (historique immuable)

## Limites connues

- Un chef_equipe doit être dans `default_team` de la mission pour voir les interventions générées (RLS standard). Premier login d'un nouvel agent → besoin d'une intervention manuelle au moins.
- `day_of_month` borné UI à 1-28 (cohérence "tous les mois"). Pas de "dernier jour du mois" encore.
- Pas de cron pour génération nocturne (lazy only). À considérer si les pages mobiles deviennent lentes.

## Paramètres par défaut

- Génération paresseuse `daysAhead` : 1 (boot mobile), peut être étendu jusqu'à 7
- Slots : `morning`=08h, `afternoon`=14h, `evening`=19h (UTC)
- ISO day-of-week : Mon=1, Sun=7

## Suite

- Phase 5 — Dossier de preuves (`/preuves`)
- Pilote terrain Phase 3 avec récurrences activées sur 3 agents réels
