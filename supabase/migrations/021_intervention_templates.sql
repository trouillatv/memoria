-- Migration 021 : Intervention templates — récurrence simple
--
-- Spec : docs/superpowers/plans/2026-05-11-phase-6-recurrence-simple.md (Slice 6.0)
-- Branch : feat/recurrence-simple
-- Doctrine : docs/superpowers/doctrines/planning-doctrine.md
--   « Le planning sert la preuve, pas la gestion des humains. »
--
-- Objectif : modéliser la répétition des interventions (la majorité du quotidien
-- cleaning) sans devenir ERP. 5 patterns simples. Génération paresseuse. Zéro
-- assignation d'agent au niveau du template.
--
-- Chaîne doctrinale préservée :
--   Engagement → Mission → Intervention → Preuve
-- Un template appartient TOUJOURS à une mission existante via mission_id NOT NULL.
-- L'intervention générée portera template_id ET mission_id (= template.mission_id).
--
-- Champs INTERDITS (rappel doctrine) sur intervention_templates :
-- voir docs/superpowers/plans/2026-05-11-phase-6-recurrence-simple.md §1 et la
-- doctrine planning §1-6 (signaux ROUGE — STOP). Le grep négatif appliqué en
-- validation Slice 6.0 doit retourner « OK no ERP patterns ».

-- ==========================================
-- Table : intervention_templates
-- ==========================================
create table public.intervention_templates (
  id              uuid primary key default gen_random_uuid(),
  mission_id      uuid not null references public.missions(id) on delete cascade,
  title           text not null,
  description     text,
  frequency       text not null check (frequency in ('daily','weekdays','weekly','monthly','one_shot')),
  slots           text[],
  day_of_week     smallint check (day_of_week is null or day_of_week between 1 and 7),
  day_of_month    smallint check (day_of_month is null or day_of_month between 1 and 31),
  starts_on       date not null,
  ends_on         date,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  deleted_at      timestamptz,

  -- Cohérence : weekly nécessite day_of_week, monthly nécessite day_of_month
  constraint chk_weekly_dow  check (frequency <> 'weekly'  or day_of_week  is not null),
  constraint chk_monthly_dom check (frequency <> 'monthly' or day_of_month is not null),

  -- Slots, si présent, doit contenir des valeurs valides
  constraint chk_slots_values check (
    slots is null or slots <@ array['morning','afternoon','evening']::text[]
  ),

  -- ends_on >= starts_on si présent
  constraint chk_ends_after_starts check (ends_on is null or ends_on >= starts_on)
);

comment on table public.intervention_templates is
  'Recette de récurrence d''une mission. Template attaché à une mission via mission_id (chaîne doctrinale préservée). Pas d''ERP, pas d''assignation d''agent.';

comment on column public.intervention_templates.mission_id is
  'Mission à laquelle ce template appartient. NOT NULL : pas de bypass de la chaîne Engagement → Mission → Intervention → Preuve.';

comment on column public.intervention_templates.frequency is
  '5 patterns simples — pas de RRULE complète. Doctrine anti-ERP.';

comment on column public.intervention_templates.slots is
  'Orthogonal à frequency. Créneaux nommés métier, pas heures précises.';

comment on column public.intervention_templates.day_of_week is
  '1-7, requis si frequency=weekly. ISO : 1=lundi, 7=dimanche.';

comment on column public.intervention_templates.day_of_month is
  '1-31, requis si frequency=monthly.';

comment on column public.intervention_templates.starts_on is
  'Date de début de génération (paresseuse). Pas avant cette date, jamais.';

comment on column public.intervention_templates.ends_on is
  'Date de fin éventuelle. Si null, génération continue tant que le template est actif.';

comment on column public.intervention_templates.deleted_at is
  'Soft-delete : désactiver ne supprime pas l''historique des interventions générées.';

-- Index utiles (filtrés sur not deleted)
create index idx_intervention_templates_mission
  on public.intervention_templates(mission_id)
  where deleted_at is null;

create index idx_intervention_templates_active
  on public.intervention_templates(active, starts_on)
  where deleted_at is null and active = true;

-- ==========================================
-- Extension de la table interventions
-- ==========================================
alter table public.interventions
  add column template_id    uuid references public.intervention_templates(id) on delete set null,
  add column scheduled_for  date,
  add column slot           text check (slot is null or slot in ('morning','afternoon','evening')),
  add column skipped_at     timestamptz,
  add column skipped_reason text,
  add column skipped_by     uuid references public.users(id) on delete set null;

comment on column public.interventions.template_id is
  'Origine d''une intervention récurrente. NULL pour les one-shots manuels.';

comment on column public.interventions.scheduled_for is
  'Date logique de l''intervention (sans heure). Utilisée pour l''idempotence de la génération paresseuse.';

comment on column public.interventions.slot is
  'Créneau métier nommé (morning/afternoon/evening), pas une heure précise. NULL pour interventions sans créneau.';

comment on column public.interventions.skipped_at is
  'Pas aujourd''hui — l''intervention reste visible mais grisée. Pas une suppression.';

comment on column public.interventions.skipped_reason is
  'Raison libre saisie au moment du skip. Geste conscient.';

comment on column public.interventions.skipped_by is
  'Utilisateur ayant marqué l''intervention sautée.';

-- Idempotence native de la génération paresseuse (UNIQUE partial)
create unique index idx_interventions_template_unique
  on public.interventions(template_id, scheduled_for, slot)
  where template_id is not null;

-- Index utiles pour les requêtes Phase 6
create index idx_interventions_template
  on public.interventions(template_id)
  where template_id is not null;

create index idx_interventions_scheduled_for
  on public.interventions(scheduled_for)
  where scheduled_for is not null;

-- ==========================================
-- RLS — admin/manager CRUD, chef_equipe lecture seule
-- ==========================================
-- Pattern aligné sur 018 (interventions : auth read + manager write) :
--   - admin & manager : FOR ALL (CRUD complet)
--   - chef_equipe : FOR SELECT (lecture seule, pas de filtre par site —
--     un chef_equipe peut consulter tous les templates ; la doctrine repose
--     sur le fait qu'il ne PEUT PAS modifier, pas sur la masquage de lecture)
alter table public.intervention_templates enable row level security;

drop policy if exists "intervention_templates admin manager full" on public.intervention_templates;
create policy "intervention_templates admin manager full"
  on public.intervention_templates
  for all
  using      (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

drop policy if exists "intervention_templates chef_equipe read" on public.intervention_templates;
create policy "intervention_templates chef_equipe read"
  on public.intervention_templates
  for select
  using (public.current_user_role() = 'chef_equipe');
