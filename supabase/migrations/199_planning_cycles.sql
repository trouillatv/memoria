-- 199 — Le ROULEMENT : l'objet métier de Guillaume (PL4).
--
-- Sa feuille papier n'est pas « vingt récurrences » : c'est UN roulement, qu'il
-- rouvre, décale, corrige. Un assistant qui génère des rythmes puis disparaît
-- dissoudrait cet objet. On le rend donc PERSISTANT.
--
-- INVARIANT ABSOLU : **le cycle est la SEULE source de vérité.** Les rythmes
-- techniques (`intervention_templates`) en sont une PROJECTION : ils portent
-- `cycle_id`, et ne sont JAMAIS éditables à la main. On les régénère.
--
-- ⚠️ RÉGÉNÉRER N'EST PAS SUPPRIMER. `interventions.template_id` est en
-- ON DELETE CASCADE (mig 021:94) : supprimer un rythme DÉTRUIRAIT les
-- interventions déjà générées — et leurs preuves. La régénération ARCHIVE
-- (`deleted_at` + `active=false`). Une preuve n'est jamais détruite par un geste
-- de rangement (doctrine, audit/03).
--
-- DOCTRINE TENUE : l'unité planifiée reste l'ÉQUIPE (`team_id`). Une équipe
-- d'une personne est autorisée, et l'écran peut l'afficher par le nom de son
-- membre — mais AUCUNE écriture ne porte un user_id. Le planning nominatif reste
-- une ligne rouge (`tests/doctrine/forbidden-symbols.test.ts`).
-- Aucune donnée RH : pas de congé, pas de disponibilité, pas d'heure travaillée.
--
-- Le `state` ('work' | 'rest') est le vocabulaire de Guillaume : sa feuille est
-- faite pour LIRE LES REPOS. Un 'rest' ne génère aucun rythme — mais il est
-- STOCKÉ, parce qu'il veut le revoir quand il rouvre sa grille.
--
-- Idempotente (rejouée par db-reproducibility.yml). Rollback : DROP des 2 tables
-- + DROP des colonnes ajoutées à intervention_templates.

-- ─── Le roulement ───────────────────────────────────────────────────────────
create table if not exists public.planning_cycles (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid,
  site_id            uuid not null references public.sites(id) on delete cascade,
  -- Un rythme technique exige une mission (intervention_templates.mission_id est
  -- NOT NULL, mig 021:27). Sans elle, rien ne peut être généré.
  mission_id         uuid not null references public.missions(id) on delete cascade,

  name               text not null check (length(name) between 1 and 200),
  cycle_length_weeks smallint not null check (cycle_length_weeks between 1 and 4),
  -- Le lundi de la « semaine A ». Sans ancrage, un cycle de 2 semaines se
  -- décalerait à la première modification.
  anchor_date        date not null,
  starts_on          date not null,
  ends_on            date,                       -- null = sans date de fin

  status             text not null default 'draft'
                       check (status in ('draft', 'published', 'stopped')),

  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_by         uuid references public.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  constraint planning_cycles_dates_chk check (ends_on is null or ends_on >= starts_on)
);

create index if not exists planning_cycles_site_idx
  on public.planning_cycles (site_id, starts_on desc) where deleted_at is null;

-- ─── Les cases de sa grille ─────────────────────────────────────────────────
create table if not exists public.planning_cycle_slots (
  id          uuid primary key default gen_random_uuid(),
  cycle_id    uuid not null references public.planning_cycles(id) on delete cascade,

  -- 0 = semaine A, 1 = semaine B… (< cycle_length_weeks, vérifié applicativement)
  week_index  smallint not null check (week_index between 0 and 3),
  -- ISO : 1 = lundi … 7 = dimanche
  weekday     smallint not null check (weekday between 1 and 7),
  -- L'ÉQUIPE (jamais une personne). Une équipe d'une personne est autorisée.
  team_id     uuid not null references public.teams(id) on delete cascade,

  -- Le vocabulaire de Guillaume. 'rest' est STOCKÉ (il veut revoir ses repos)
  -- mais ne génère AUCUN rythme.
  state       text not null default 'work' check (state in ('work', 'rest')),

  start_time  text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    text check (end_time is null or end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  created_at  timestamptz not null default now(),

  -- Une seule case par (roulement, semaine, jour, équipe).
  constraint planning_cycle_slots_unique unique (cycle_id, week_index, weekday, team_id)
);

create index if not exists planning_cycle_slots_cycle_idx
  on public.planning_cycle_slots (cycle_id, week_index, weekday);

-- ─── Le rythme technique devient la PROJECTION d'un roulement ───────────────
-- Colonnes ADDITIVES et NULLABLES : un rythme legacy (sans cycle) se comporte
-- exactement comme avant. Le moteur (lib/planning/projection.ts) ignore la
-- branche cyclique quand `cycle_length_weeks` est NULL.
alter table public.intervention_templates
  add column if not exists cycle_id           uuid references public.planning_cycles(id) on delete cascade,
  add column if not exists cycle_length_weeks smallint check (cycle_length_weeks is null or cycle_length_weeks between 1 and 4),
  add column if not exists anchor_date        date,
  add column if not exists week_index         smallint check (week_index is null or week_index between 0 and 3),
  -- L'ÉQUIPE du rythme. Elle prime sur celle de la mission : c'est ce qui rend
  -- possible « équipe A le lundi, équipe B le mardi » — impossible jusqu'ici,
  -- car assigned_team_id ne vivait que sur la MISSION.
  add column if not exists assigned_team_id   uuid references public.teams(id) on delete set null;

create index if not exists intervention_templates_cycle_idx
  on public.intervention_templates (cycle_id) where cycle_id is not null;

alter table public.planning_cycles enable row level security;
alter table public.planning_cycle_slots enable row level security;

-- Lecture : les chantiers de mon organisation. Écriture : service-role (Server
-- Actions) — même pattern que site_blocages (160), site_decisions (136).
drop policy if exists "planning_cycles read" on public.planning_cycles;
create policy "planning_cycles read" on public.planning_cycles
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

drop policy if exists "planning_cycle_slots read" on public.planning_cycle_slots;
create policy "planning_cycle_slots read" on public.planning_cycle_slots
  for select using (
    cycle_id in (
      select c.id from public.planning_cycles c
      join public.sites s on s.id = c.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );

comment on table public.planning_cycles is
  'Le ROULEMENT (mig 199, PL4) — l''objet métier de Guillaume. SOURCE DE VÉRITÉ : les intervention_templates qui portent cycle_id en sont une PROJECTION, jamais éditable à la main. Régénérer = ARCHIVER les anciens (jamais DELETE : la FK interventions.template_id est en CASCADE et détruirait les preuves).';

comment on table public.planning_cycle_slots is
  'Les cases de la grille (mig 199) — (semaine, jour, équipe, travail/repos, horaires). L''unité est l''ÉQUIPE, jamais une personne. Un ''rest'' est STOCKÉ (Guillaume veut revoir ses repos) mais ne génère aucun rythme.';
