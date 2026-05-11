# Phase 9 — Vue Semaine & Équipes (planning V2)

> Plan d'implémentation. Doctrine V2 (Organisation vs Surveillance) appliquée intégralement. Cf. `docs/superpowers/doctrines/planning-doctrine.md` (V2).

**Goal** : permettre aux superviseurs cleaning d'organiser la couverture opérationnelle des engagements sans recourir à Excel, tout en respectant strictement la doctrine V2 (anonymisation en supervision, affectation par équipe jamais par agent, pas de métrique de surveillance).

**Architecture** : nouvelle couche `teams` + `team_members` + `assigned_team_id` sur missions/interventions. Vue Site × Jour primaire (grille statique avec drag & drop), Vue Équipe × Jour secondaire (accès discret). Page Équipes isolée pour gérer la composition (seul endroit avec noms d'agents en supervision).

**Tech Stack** : Next.js 16 App Router, Supabase (Postgres + RLS), React Server Components + Server Actions, drag & drop via `@dnd-kit/core` ou approche native HTML5 selon ce qui est le plus sobre, Tailwind v4.

**Prérequis** : doctrine V2 mergée sur main (✅ commit `dee99f7`).

---

## 1. File Structure

```
supabase/migrations/
  023_teams_and_assignment.sql            ← Slice 9.0

lib/db/
  teams.ts                                ← Slice 9.1 — CRUD teams + members
  week-planning.ts                        ← Slice 9.1 — list interventions par semaine groupées

app/(dashboard)/
  equipes/
    page.tsx                              ← Slice 9.2 — liste équipes + composition
    actions.ts                            ← Slice 9.2 — CRUD server actions
    CreateTeamForm.tsx                    ← Slice 9.2
    EditTeamMembersDialog.tsx             ← Slice 9.2

  semaine/
    page.tsx                              ← Slice 9.3 — Vue Site × Jour
    actions.ts                            ← Slice 9.4 — réassignation server action
    WeekGrid.tsx                          ← Slice 9.3 — grille statique
    WeekGridCell.tsx                      ← Slice 9.3 — cellule (mission + équipe)
    WeekNavigation.tsx                    ← Slice 9.3 — ◀/▶/Aujourd'hui
    DraggableMission.tsx                  ← Slice 9.4 — wrapper drag
    ReassignDialog.tsx                    ← Slice 9.4 — modal réassignation
    TeamWeekView.tsx                      ← Slice 9.5 — Vue Équipe × Jour
    view-mode-storage.ts                  ← Slice 9.5 — toggle preference

components/ui/
  team-badge.tsx                          ← Slice 9.2 — badge équipe sobre

scripts/
  phase9-smoke.ts                         ← Slice 9.6

docs/superpowers/notes/
  2026-05-phase9-vue-semaine.md           ← Slice 9.6
```

---

## 2. Slices

### Slice 9.0 — Migration DB (~30 min)

**Files** : `supabase/migrations/023_teams_and_assignment.sql`, `types/db.ts`, `tests/lib/teams-db.test.ts`

**Schéma** :

```sql
-- Teams = conteneurs de couverture, jamais unités analytiques
CREATE TABLE public.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text,  -- pour lisibilité visuelle, jamais sémantique
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at  timestamptz,
  CONSTRAINT chk_team_name_length CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 50)
);

CREATE UNIQUE INDEX idx_teams_name_active ON public.teams(lower(name)) WHERE deleted_at IS NULL;

-- Composition d'équipe — variable dans le temps (joined_at + left_at = NULL signifie "actuellement membre")
CREATE TABLE public.team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz
);

CREATE INDEX idx_team_members_team_active ON public.team_members(team_id) WHERE left_at IS NULL;
CREATE INDEX idx_team_members_user_active ON public.team_members(user_id) WHERE left_at IS NULL;

-- Un user ne peut pas être 2x dans la même équipe simultanément
CREATE UNIQUE INDEX idx_team_members_active_unique
  ON public.team_members(team_id, user_id)
  WHERE left_at IS NULL;

-- Affectation par équipe (jamais par user)
ALTER TABLE public.missions
  ADD COLUMN assigned_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.interventions
  ADD COLUMN assigned_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX idx_missions_assigned_team ON public.missions(assigned_team_id) WHERE assigned_team_id IS NOT NULL;
CREATE INDEX idx_interventions_assigned_team ON public.interventions(assigned_team_id) WHERE assigned_team_id IS NOT NULL;
CREATE INDEX idx_interventions_scheduled_for ON public.interventions(scheduled_for) WHERE scheduled_for IS NOT NULL;

-- RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manager full access teams"
  ON public.teams
  USING (public.current_user_role() IN ('admin','manager'))
  WITH CHECK (public.current_user_role() IN ('admin','manager'));

CREATE POLICY "chef_equipe read teams"
  ON public.teams
  FOR SELECT
  USING (public.current_user_role() = 'chef_equipe');

CREATE POLICY "admin manager full access team_members"
  ON public.team_members
  USING (public.current_user_role() IN ('admin','manager'))
  WITH CHECK (public.current_user_role() IN ('admin','manager'));

CREATE POLICY "chef_equipe read own team_membership"
  ON public.team_members
  FOR SELECT
  USING (public.current_user_role() = 'chef_equipe' AND user_id = auth.uid());

COMMENT ON TABLE public.teams IS
  'Doctrine V2 : conteneur logistique de couverture. JAMAIS unité analytique. Pas de score, pas de KPI, pas de charge.';
COMMENT ON COLUMN public.missions.assigned_team_id IS
  'Affectation par équipe. NE JAMAIS introduire assigned_to_user_id.';
```

**Types TS** :

```ts
export interface DbTeam {
  id: string
  name: string
  color: string | null
  active: boolean
  created_at: string
  created_by: string | null
  deleted_at: string | null
}

export interface DbTeamMember {
  id: string
  team_id: string
  user_id: string
  joined_at: string
  left_at: string | null
}

// Extend DbMission, DbIntervention :
// assigned_team_id: string | null
```

**Tests** : insertion équipe valide, contrainte name longueur, contrainte unicité nom actif, contrainte unicité membership actif, cascade ON DELETE team, ON DELETE SET NULL sur missions/interventions au DELETE team, RLS admin/manager full vs chef_equipe read-only.

**Commit** : `feat(planning): Slice 9.0 — migration DB teams + team_members + assigned_team_id`

---

### Slice 9.1 — Helpers DB (~45 min)

**Files** : `lib/db/teams.ts`, `lib/db/week-planning.ts`, `tests/lib/teams.test.ts`, `tests/lib/week-planning.test.ts`

**API teams.ts** :

```ts
export interface CreateTeamInput { name: string; color?: string }
export interface UpdateTeamInput { name?: string; color?: string; active?: boolean }

export async function listTeams(): Promise<DbTeam[]>
export async function getTeam(id: string): Promise<DbTeam | null>
export async function createTeam(input: CreateTeamInput): Promise<DbTeam>
export async function updateTeam(id: string, input: UpdateTeamInput): Promise<DbTeam>
export async function archiveTeam(id: string): Promise<void>  // soft-delete via deleted_at + UPDATE interventions/missions SET assigned_team_id=NULL where assigned_team_id=id

export interface TeamWithMemberCount extends DbTeam { memberCount: number }
export async function listTeamsWithMemberCount(): Promise<TeamWithMemberCount[]>

export interface TeamMemberWithUser {
  membership: DbTeamMember
  user: { id: string; full_name: string | null; email: string }
}
export async function listMembersOfTeam(teamId: string): Promise<TeamMemberWithUser[]>
export async function addMemberToTeam(teamId: string, userId: string): Promise<DbTeamMember>
export async function removeMemberFromTeam(teamId: string, userId: string): Promise<void>  // sets left_at

// Pour le mobile agent : retourne les team_id actifs de cet user
export async function listActiveTeamIdsForUser(userId: string): Promise<string[]>
```

**API week-planning.ts** :

```ts
export interface WeekRange { weekStart: string; weekEnd: string }  // ISO dates (Lundi → Dimanche)

export interface WeekInterventionCell {
  id: string
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string
  contract_name: string
  scheduled_for: string
  slot: string | null
  status: string
  skipped_at: string | null
  assigned_team_id: string | null
  assigned_team_name: string | null
  assigned_team_color: string | null
}

export interface SiteRow {
  site_id: string
  site_name: string
  contract_id: string
  contract_name: string
  days: Record<string, WeekInterventionCell[]>  // key = yyyy-mm-dd
}

export interface TeamRow {
  team_id: string | null  // null = "Non-affecté"
  team_name: string
  team_color: string | null
  member_count: number  // pour info, jamais utilisé comme métrique de perf
  days: Record<string, WeekInterventionCell[]>
}

export function getWeekRange(reference: Date): WeekRange  // ISO week, Lundi → Dimanche
export async function listInterventionsForWeek(range: WeekRange): Promise<WeekInterventionCell[]>
export async function getWeekBySite(range: WeekRange): Promise<SiteRow[]>
export async function getWeekByTeam(range: WeekRange): Promise<TeamRow[]>
```

**Tests** : 12+ specs (CRUD teams, soft-delete cascade SET NULL, member add/remove, idempotence, getWeekBySite avec différents filtres, getWeekRange (lundi de semaine ISO), tri sites par contrat, tri équipes par nom, "Non-affecté" comme dernière ligne).

**Commit** : `feat(planning): Slice 9.1 — helpers DB teams + week-planning`

---

### Slice 9.2 — Page /equipes (~45 min)

**Files** : `app/(dashboard)/equipes/page.tsx`, `actions.ts`, `CreateTeamForm.tsx`, `EditTeamMembersDialog.tsx`, `components/ui/team-badge.tsx`, `tests/components/team-forms.test.tsx`

**UX** : page accessible admin/manager uniquement. Lien sidebar "Équipes" avec icône `Users`. Layout simple :

```
┌─────────────────────────────────────────────────────────────┐
│  Équipes                              [+ Nouvelle équipe]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ● Alpha · 4 personnes                  [Éditer composition]│
│  Mehdi · Léa · Karim · Sarah                                │
│                                                             │
│  ● Beta · 3 personnes                   [Éditer composition]│
│  Yann · Aïcha · Tarek                                       │
│                                                             │
│  ⚠ 2 personnes pas dans une équipe                          │
│  Sofia · Mathieu                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Garde-fous absolus sur cette page** :
- **Zéro métrique individuelle** (pas d'historique d'activité, pas de stats, pas de "missions cette semaine par X")
- **Zéro métrique d'équipe** (pas de "charge", pas de "couverture", pas de "saturation")
- Seules infos : nom, composition (liste de noms), couleur sobre (optionnelle)
- C'est le SEUL endroit où on voit des noms d'agents en supervision

**Server actions** :
- `createTeamAction({ name, color? })` — auth manager+
- `updateTeamAction({ id, name?, color?, active? })`
- `archiveTeamAction({ id })` — confirme, soft-delete + désaffecte missions/interventions
- `addMemberToTeamAction({ teamId, userId })`
- `removeMemberFromTeamAction({ teamId, userId })`

**TeamBadge component** : pill avec couleur sobre (bg + border + text), name (et optionnel member count). Réutilisable sur week-grid.

**Commit** : `feat(planning): Slice 9.2 — page /equipes (composition isolée, zéro métrique)`

---

### Slice 9.3 — Page /semaine Vue Site × Jour (read only) (~60 min)

**Files** : `app/(dashboard)/semaine/page.tsx`, `WeekGrid.tsx`, `WeekGridCell.tsx`, `WeekNavigation.tsx`, `tests/components/week-grid.test.tsx`

**UX** :

```
┌─────────────────────────────────────────────────────────────────┐
│  Semaine du 12 au 18 mai 2026          [Vue Site ▾]             │
│  ◀ Précédente · Aujourd'hui · Suivante ▶                        │
├──────────┬───────┬───────┬───────┬───────┬───────┬───────┬─────┤
│          │Lun 12 │Mar 13 │Mer 14 │Jeu 15 │Ven 16 │Sam 17 │Dim18│
├──────────┼───────┼───────┼───────┼───────┼───────┼───────┼─────┤
│ CHU      │● m+s  │● m    │● m+s  │● m    │● m+s  │  —    │  —  │
│ Régional │Alpha  │Alpha  │Beta   │Alpha  │Alpha  │       │     │
├──────────┼───────┼───────┼───────┼───────┼───────┼───────┼─────┤
│ Banque   │● s    │● s    │● s    │● s    │● s    │  —    │  —  │
│ Centrale │Alpha  │Alpha  │Alpha  │Alpha  │Alpha  │       │     │
└──────────┴───────┴───────┴───────┴───────┴───────┴───────┴─────┘
```

**Détails** :
- 7 colonnes (Lun → Dim), tri sites par contract_name puis site_name
- Cellules : indicateur visuel `●` (1 mission) ou `●●` (multi-missions), suivi du créneau (`m`, `s`, `m+s`), suivi de la team badge (couleur + nom court)
- Cellule vide = `—` muted
- Cellule non-affectée = `◯` ambre + tooltip "Aucune équipe affectée"
- Click cellule → drawer latéral (lecture seule en 9.3) avec détail des missions du jour pour ce site
- Pas de drag & drop dans cette slice (Slice 9.4)
- Lien sidebar "Semaine" avec icône `Calendar`
- Critère doctrine respecté : créneaux nommés (jamais d'heure précise)

**WeekNavigation** : 3 boutons (`◀ Précédente`, `Aujourd'hui`, `Suivante ▶`) + label de la semaine. State via URL `?week=2026-W19` (ISO week).

**Commit** : `feat(planning): Slice 9.3 — page /semaine Vue Site × Jour read-only`

---

### Slice 9.4 — Drag & drop + réassignation (~60 min)

**Files** : `app/(dashboard)/semaine/DraggableMission.tsx`, `ReassignDialog.tsx`, `actions.ts`, `tests/lib/reassign.test.ts`

**Doctrine** :
- Drag missions entre jours (replanification, change `scheduled_for`)
- Drag missions entre cellules d'équipes (réassignation, change `assigned_team_id`)
- **JAMAIS** drag mission → un agent individuel
- Pas de drag temps réel agressif : drop déclenche server action + optimistic UI + skeleton de retour
- Pas de "live cursor", pas de présence collaborative
- Une PR sur la grille = un changement à la fois (pas de batch update)

**Lib** : `@dnd-kit/core` (déjà éprouvée, accessible clavier, mobile-friendly).

```bash
npm install @dnd-kit/core
```

**Server actions** :

```ts
export async function moveInterventionToDayAction(input: {
  interventionId: string
  newScheduledFor: string  // yyyy-mm-dd
}): Promise<{ ok: boolean; error?: string }>

export async function reassignInterventionTeamAction(input: {
  interventionId: string
  newTeamId: string | null  // null = désaffecter
}): Promise<{ ok: boolean; error?: string }>
```

Vérifications :
- L'intervention doit être status `planned` (pas en cours / terminée)
- Audit log : `intervention_moved` / `intervention_team_reassigned` avec old/new value
- revalidatePath sur `/semaine`

**ReassignDialog** : modal légère ouverte sur click "Réassigner équipe" dans le drawer cellule. Liste radio des équipes actives + option "Non-affecté". Pas de drag agent dans la modal.

**Garde-fous** :
- Drop sur cellule "passée" (jour < aujourd'hui) → bloqué silencieusement avec toast info
- Drop sur cellule "intervention en cours" → bloqué + toast "intervention déjà démarrée"
- Animation drop douce (transition 200ms), pas de spring fancy

**Commit** : `feat(planning): Slice 9.4 — drag & drop + réassignation équipe`

---

### Slice 9.5 — Vue Équipe × Jour (secondaire) (~45 min)

**Files** : `TeamWeekView.tsx`, `view-mode-storage.ts`, update `page.tsx`, `tests/components/team-week-view.test.tsx`

**UX** : toggle dans le header semaine.

```
[Vue Site ▾]   <-- primaire, par défaut
[Vue Équipe ▾] <-- secondaire, accessible en switchant
```

```
┌─────────────────────────────────────────────────────────────┐
│  Semaine du 12 au 18 mai 2026         [Vue Équipe ▾]        │
├──────────┬───────┬───────┬───────┬───────┬───────┬───────┬──┤
│          │Lun 12 │Mar 13 │Mer 14 │Jeu 15 │Ven 16 │Sam 17 │Di│
├──────────┼───────┼───────┼───────┼───────┼───────┼───────┼──┤
│ Alpha    │CHU m+s│CHU m  │       │CHU m  │CHU m+s│       │  │
│ (4 pers.)│Banq s │Banq s │Banq s │Banq s │Banq s │       │  │
├──────────┼───────┼───────┼───────┼───────┼───────┼───────┼──┤
│ Beta     │Éc m   │Éc m   │Éc m   │Éc m   │Éc m   │       │  │
│ (3 pers.)│       │St-M m │CHU m  │       │       │St-M m │  │
├──────────┼───────┼───────┼───────┼───────┼───────┼───────┼──┤
│ Non-     │St-M m+│       │St-M m+│St-M m │St-M m+│       │  │
│ affecté ⚠│       │       │       │       │       │       │  │
└──────────┴───────┴───────┴───────┴───────┴───────┴───────┴──┘
```

**Garde-fous** :
- "Alpha (4 personnes)" — affichage du **nombre** uniquement, jamais des noms
- "Non-affecté" en dernier, badge ambre discret
- Cellules droppables (réutilise les server actions de 9.4)
- Pas de stat "charge équipe" / "missions cette semaine par équipe"

**Toggle storage** : localStorage `netoiage:week-view-mode` = `'site'` ou `'team'`, default `'site'`. URL `?view=team` override pour partage.

**Commit** : `feat(planning): Slice 9.5 — Vue Équipe × Jour (secondaire, sans métrique)`

---

### Slice 9.6 — Polish + smoke + doc (~30 min)

**Files** : `scripts/phase9-smoke.ts`, `scripts/seed-demo.ts` (enrich), `docs/superpowers/notes/2026-05-phase9-vue-semaine.md`

**Seed enrichissement** :
- 3 équipes seedées : `Alpha`, `Beta`, `Gamma`
- 2-3 chef_equipe répartis par équipe
- Quelques missions assignées à une équipe, d'autres laissées à `assigned_team_id=NULL` pour démontrer le "Non-affecté"

**Smoke test** :
- createTeam → row + UNIQUE name
- addMemberToTeam → membership active
- removeMemberFromTeam → left_at NOT NULL
- assignInterventionTeamAction → assigned_team_id updaté
- getWeekBySite vs getWeekByTeam → cohérence des comptes totaux
- archiveTeam → désaffecte missions + interventions

**Doc note** : Quoi/Pourquoi/Stack/Doctrine/Décisions/Limites/Paramètres/Suite (1 page).

**Commit** : `feat(planning): Slice 9.6 — polish + smoke + doc (Phase 9 closed)`

---

## 3. Tests d'acceptation finale (avant merge)

| Critère | Comment vérifier |
|---|---|
| Aucun `assigned_to_user_id` dans le diff | `git diff main..feat/phase-9-vue-semaine \| grep "assigned_to"` → vide |
| Aucune métrique d'équipe affichée | grep `charge\|saturation\|productivité.*équipe\|heatmap` → 0 hit user-facing |
| Aucun nom d'agent sur la vue semaine | inspection visuelle + grep dans WeekGrid/TeamWeekView |
| Vue Site × Jour est primaire | default toggle = 'site', l'URL canonique sans param l'affiche |
| Pas de slots horaires précis | les cellules affichent `m`/`s`/`e`, jamais `08:00` |
| Drag & drop fonctionne (replanification + réassignation) | test composant + manuel |
| ON DELETE team → SET NULL sur missions/interventions | test DB |
| Tests : suite verte (>= 361 + nouveaux) | `npx vitest run` |
| Typecheck : 0 erreur | `npm run typecheck` |
| Smoke phase9 : green | `npx tsx scripts/phase9-smoke.ts` |

---

## 4. Non-goals (Phase 9 fermée explicitement)

- ❌ Calendrier avec slots horaires précis (8h-12h)
- ❌ Vue Gantt
- ❌ Optimisation automatique des affectations
- ❌ Suggestion IA "qui assigner"
- ❌ Notification push à l'agent en cas de réassignation
- ❌ Drag & drop d'agents entre équipes depuis la grille semaine (ça se fait sur la page Équipes uniquement)
- ❌ Métrique de "charge" / "saturation" / "couverture" / "complétion" par équipe
- ❌ Comparaison inter-équipes
- ❌ Présence implicite ("en ligne", "actif")
- ❌ Refresh auto agressif (< 30s)
- ❌ Live cursor / collaboration temps réel
- ❌ Audit "qui a réassigné quoi" exposé en UI

## 5. Séquence d'exécution

```
Slice 9.0 — Migration DB                   (1 subagent, ~30 min)
   ↓
Slice 9.1 — Helpers DB + week-planning     (1 subagent, ~45 min)
   ↓
Slice 9.2 — Page /equipes                  (1 subagent, ~45 min)
   ↓
Slice 9.3 — Page /semaine Site × Jour ro   (1 subagent, ~60 min)
   ↓
Slice 9.4 — Drag & drop + réassignation    (1 subagent, ~60 min)
   ↓
Slice 9.5 — Vue Équipe × Jour secondaire   (1 subagent, ~45 min)
   ↓
Slice 9.6 — Polish + smoke + doc           (1 subagent, ~30 min)
```

Total estimé : ~5h subagents. Branche `feat/phase-9-vue-semaine` (déjà créée).
