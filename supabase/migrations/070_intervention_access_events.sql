-- Migration 070 — Preuve d'accès site : prise / restitution / incident.
--
-- Spec : conception validée Vincent 2026-05-18 (Clefs/Badges SPI).
-- Doctrine MemorIA — ce module est une PREUVE D'ACCÈS, PAS un registre de
-- détention. Garde-fous gravés dans le schéma :
--   - AUCUNE colonne "détenteur" / "porteur". `created_by` = audit interne
--     uniquement, jamais surfacé en UI (pattern site_notes, migration 033).
--   - Équipe anonyme : pas de lien nominatif, pas d'historique agent.
--   - Pas d'inventaire de clés, pas de QR, pas de NFC, pas de GPS.
--
-- Modèle :
--   - prise/restitution = événement d'accès (cette table). PAS une anomalie.
--   - incident d'accès   = anomalie réutilisée (intervention_anomalies,
--                          category='acces_bloque') + ligne miroir ici avec
--                          anomaly_id renseigné. JAMAIS un système parallèle.
--   - photo              = OPTIONNELLE (intervention_photos kind='access').
--
-- requires_return : tous les accès n'attendent pas de restitution (badge
-- jetable, clé conservée 48h, accès chantier). Sans ce champ le système
-- supposerait toujours pickup → return attendu. Défaut true (cas hôpital).
--
-- deferred : restitution différée documentée à la clôture ("continuer sans
-- restitution + note obligatoire"). Terme NEUTRE et opérationnel — jamais
-- "non rendu" qui impliquerait une faute.

create type access_event_type   as enum ('pickup', 'return', 'incident');
create type access_event_source as enum ('pc_securite', 'spi', 'accueil', 'autre');

create table public.intervention_access_events (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  type            access_event_type not null,
  source          access_event_source not null default 'autre',
  note            text check (note is null or char_length(note) <= 280),
  -- Photo optionnelle du trousseau / badge (kind='access', migration 069).
  photo_id        uuid references public.intervention_photos(id) on delete set null,
  -- Si type='incident' : lien vers l'anomalie réutilisée (pas de doublon).
  anomaly_id      uuid references public.intervention_anomalies(id) on delete set null,
  -- N'a de sens que pour type='pickup' : cet accès attend-il une restitution ?
  requires_return boolean not null default true,
  -- N'a de sens que pour type='return' : restitution différée à la clôture.
  deferred        boolean not null default false,
  occurred_at     timestamptz not null default now(),  -- horodatage serveur opposable
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index intervention_access_events_intervention_idx
  on public.intervention_access_events(intervention_id);
create index intervention_access_events_type_idx
  on public.intervention_access_events(intervention_id, type);

comment on table public.intervention_access_events is
  'Preuve d''accès site (prise/restitution/incident). PAS un registre de détention. Aucune colonne détenteur. created_by = audit interne, jamais surfacé UI.';
comment on column public.intervention_access_events.requires_return is
  'type=pickup uniquement : false pour badge jetable / accès sans restitution attendue. Pilote la demande de clôture.';
comment on column public.intervention_access_events.deferred is
  'type=return uniquement : restitution différée documentée à la clôture. Terme neutre — jamais « non rendu ».';

-- ==========================================
-- Flag site : le bloc accès n'apparaît QUE sur les sites concernés.
-- Anti-surcharge cognitive : 80% des sites n'ont pas de remise de clés.
-- Pattern aligné sur 036_site_extended_fields.
-- ==========================================
alter table public.sites
  add column if not exists requires_access_handover boolean not null default false;

comment on column public.sites.requires_access_handover is
  'Si true : le workflow de preuve d''accès (prise/restitution clés/badge) est proposé sur ce site. Défaut false.';

-- ==========================================
-- RLS — pattern identique à intervention_photos / intervention_anomalies
-- (migrations 018 + 019).
-- ==========================================
alter table public.intervention_access_events enable row level security;

drop policy if exists "intervention_access_events auth read" on public.intervention_access_events;
create policy "intervention_access_events auth read" on public.intervention_access_events
  for select using (auth.role() = 'authenticated');

drop policy if exists "intervention_access_events manager write" on public.intervention_access_events;
create policy "intervention_access_events manager write" on public.intervention_access_events
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- chef_equipe peut INSERT seulement pour ses propres interventions (team[]).
drop policy if exists "intervention_access_events chef_equipe insert" on public.intervention_access_events;
create policy "intervention_access_events chef_equipe insert" on public.intervention_access_events
  for insert
  with check (
    public.current_user_role() = 'chef_equipe'
    and exists (
      select 1 from public.interventions i
      where i.id = intervention_id
      and auth.uid() = any(i.team)
    )
  );
