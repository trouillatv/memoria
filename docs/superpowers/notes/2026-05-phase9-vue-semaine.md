# Phase 9 — Vue Semaine & Équipes

**Date** : 2026-05-12 (closed)
**Branche** : feat/phase-9-vue-semaine

## Quoi

La **couche organisationnelle** au-dessus de Field MVP : trois objets seulement —
`teams` (conteneurs logistiques de couverture), `team_members` (composition
variable dans le temps), `assigned_team_id` sur missions et interventions. Et
deux pages : `/equipes` (composition isolée) + `/semaine` (Vue Site × Jour
primaire, Vue Équipe × Jour secondaire, drag & drop entre cellules).

## Pourquoi

Phases 1-7 ont prouvé la collecte d'engagements et la production de preuves.
Le **feedback terrain** sur le pilote a montré le manque criant : sans une
couche de couverture (qui-couvre-quoi-quand), les superviseurs retombaient
sur Excel à côté de l'app. Phase 9 reprend ce besoin sans dériver vers
l'ERP de planning ni la surveillance — on **organise la couverture**, on
**ne mesure jamais les humains**.

## Stack

- **Migration 023** — `teams` + `team_members` + `assigned_team_id` (missions/interventions),
  UNIQUE partial sur `lower(name) WHERE deleted_at IS NULL`, unicité membership
  actif sur `(team_id, user_id) WHERE left_at IS NULL`.
- **Helpers** `lib/db/teams.ts` (CRUD + soft-delete + memberCount info-only +
  orphan users) et `lib/db/week-planning.ts` (`getWeekRange` ISO 8601,
  `getWeekBySite` primaire, `getWeekByTeam` secondaire avec "Non-affecté" en dernier).
- **Page /equipes** — composition seulement, zéro métrique, seul endroit où
  des noms d'agents apparaissent en supervision (test ultime "identifiants abstraits").
- **Page /semaine** — toggle `?view=site|team` (default `site` sans param URL),
  grille 7 colonnes, `@dnd-kit/core` pour le drag, server actions
  `moveInterventionToDayAction` + `reassignInterventionTeamAction` avec audit.
- **Seed démo enrichi** — 3 équipes (Alpha sky / Beta emerald / Gamma violet),
  7 chef_equipe (5 affectés, 2 orphelins), quelques missions volontairement
  laissées sans équipe (démonstration "Non-affecté").

## Doctrine V2 respectée

- **Organisation vs Surveillance** : c'est explicitement de l'organisation
  logistique. Aucun KPI par personne ni par équipe.
- **Test ultime "identifiants abstraits"** : remplacer Alpha/Beta/Gamma par
  T1/T2/T3 ne change rien à la sémantique — preuve qu'on n'instrumente pas
  les humains.
- **`member_count` info-only** : utilisé pour afficher « Alpha · 4 personnes »,
  jamais comme dénominateur d'un ratio. Une PR future qui introduirait
  "charge équipe" ou "saturation" est refusée d'office.
- **Vue Site × Jour primaire** : URL canonique sans param affiche Site.
  Équipe n'est qu'un repère secondaire (le toggle est un service, pas un
  glissement vers l'analytique RH).

## Décisions clés

- **Affectation par équipe, jamais par user** : aucun `assigned_to_user_id`.
  Une PR qui en introduirait un est refusée doctrinalement.
- **`archiveTeam` = soft-delete + désaffecte interventions PLANIFIÉES,
  conserve completed/validated** : immuabilité de la preuve. Le filet de
  sécurité FK `ON DELETE SET NULL` est là pour le hard-delete, qu'on évite.
- **Drop par drag déclenche une mutation server, pas un live cursor** :
  optimistic UI + revalidatePath. Pas de présence implicite, pas de batch.
- **Page Équipes isolée** : la seule à exposer les noms. Partout ailleurs,
  on parle "Équipe Alpha (4 personnes)".

## Limites connues

- **Pas de batch action** : une mission à la fois pour replanif / reassign.
  Volontaire pour V1, à instrumenter plus tard si le terrain le réclame.
- **`AuditEntityType` pas étendu** à `team` / `intervention`. Les évènements
  `intervention_moved` / `intervention_team_reassigned` sont loggés sous
  `entityType='mission'` avec `metadata.kind` discriminant. Refactor possible
  si besoin de filtrage fin côté audit log UI.
- **Pas de "dernier jour du mois"** ni de RRULE complète — hors scope Phase 9
  (héritage Phase 6 récurrence simple).
- **Pas de notification push** à l'agent en cas de réassignation — feedback
  hors-app suffit pour V1.

## Paramètres par défaut

- ISO 8601 strict : Lundi=1 → Dimanche=7 (toutes les semaines).
- URL semaine : `?week=YYYY-Www` (parse fail-safe → semaine courante).
- URL vue : `?view=team` override ; default = `site` (URL canonique sans param).
- LocalStorage : `netoiage:week-view-mode` (persistance pref user, override
  par URL si présent).
- Timezone : tout en UTC côté serveur (date pure yyyy-mm-dd, pas de timezone
  applicative).
- `slot` : `morning` / `afternoon` / `evening` — créneaux nommés uniquement,
  jamais d'heure précise affichée.

## Suite

- **Pilote terrain réel** sur Phase 9 (1-2 sites pilotes, retour 2 semaines).
- Si le besoin émerge : extension `AuditEntityType` pour `team` (audit log UI
  filtrable). Sinon, on garde l'architecture actuelle.
- Phase 10 hors scope ici — laissée ouverte par le doctrine V2.
