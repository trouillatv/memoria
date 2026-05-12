-- ============================================================================
-- Migration 024 — intervention_participants (Phase 10 — Doctrine V3)
-- ============================================================================
--
-- Stocke les PARTICIPANTS CONTEXTUELS d'une intervention :
-- la réalité du terrain, pas la prévision organisationnelle.
--
-- Doctrine V3 — cf. docs/superpowers/doctrines/planning-doctrine.md
--
--   ✅ « Participants de l'intervention X »  → autorisé
--   ❌ « Interventions de Pierre »            → interdit (asymétrie)
--   ✅ Lecture par CONTEXTE D'ÉVÉNEMENT (intervention connue)
--   ❌ Lookup user → events (pas d'index user_id seul, marqueur doctrinal)
--
-- Trois couches de vérité humaine :
--   🟦 Équipe affectée   (intervention.assigned_team_id)   — organisation prévue
--   🟨 Participants      (intervention_participants)        — réalité contextuelle
--   🟩 Actions nominatives (taken_by, done_by, validated_by) — preuve granulaire
--
-- Règle V3 : « Ne jamais écrire automatiquement une vérité humaine non
-- confirmée. » L'UI mobile suggère, le chef d'équipe CONFIRME, alors on écrit.
--
-- Choix techniques (audités par db-rls-reviewer 2026-05-12) :
--   - PAS d'enum : `role text + check` pour rétractabilité future
--   - PAS d'index sur user_id seul (marqueur doctrinal anti reverse-lookup)
--   - FK on delete cascade sur user_id : suit la chaîne RGPD auth.users
--   - Helpers SECURITY DEFINER pour éviter récursion RLS
--   - Trigger d'immuabilité après status completed/validated
--   - UPDATE interdit (delete + insert pour changer un rôle, traçable)

-- ----------------------------------------------------------------------------
-- 1) Table
-- ----------------------------------------------------------------------------

create table public.intervention_participants (
  intervention_id uuid not null
    references public.interventions(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  role text not null default 'participant'
    check (role in ('participant', 'referent')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  primary key (intervention_id, user_id)
);

comment on table public.intervention_participants is
  'Doctrine V3 — FAIT contextuel : qui était présent sur l''intervention. '
  'Lookup asymétrique : lecture par intervention_id, jamais par user_id.';

comment on column public.intervention_participants.role is
  'participant = présence factuelle. referent = point de contact opérationnel. '
  'PAS de hiérarchie déguisée (responsable, chef, lead, senior interdits).';

comment on column public.intervention_participants.user_id is
  'on delete cascade : suit la chaîne RGPD (auth.users → public.users). '
  'Les actions nominatives (photo.taken_by, etc.) restent comme trace de preuve.';

-- ----------------------------------------------------------------------------
-- 2) Index
-- ----------------------------------------------------------------------------

-- PK couvre déjà (intervention_id, user_id) — query principale : détail intervention.
-- PAS d'index sur user_id seul : marqueur doctrinal. Le seq scan reste possible
-- pour usage forensic admin, c'est volontairement non optimisé.

-- Index partiel sur les référents : utile pour "qui est référent ici" (1/intervention typiquement).
create index idx_intervention_participants_referent
  on public.intervention_participants(intervention_id)
  where role = 'referent';

-- ----------------------------------------------------------------------------
-- 3) Helpers SECURITY DEFINER (cassent la récursion RLS)
-- ----------------------------------------------------------------------------

create or replace function public.is_referent_of_intervention(p_intervention uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1 from public.intervention_participants
    where intervention_id = p_intervention
      and user_id = auth.uid()
      and role = 'referent'
  )
$$;

create or replace function public.is_team_member_of_intervention(p_intervention uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.interventions i
    join public.team_members tm
      on tm.team_id = i.assigned_team_id
     and tm.user_id = auth.uid()
     and tm.left_at is null
    where i.id = p_intervention
  )
$$;

comment on function public.is_referent_of_intervention(uuid) is
  'Helper RLS. SECURITY DEFINER pour casser la récursion sur intervention_participants.';

comment on function public.is_team_member_of_intervention(uuid) is
  'Helper RLS. SECURITY DEFINER. Membre actif (left_at IS NULL) de l''équipe affectée.';

-- ----------------------------------------------------------------------------
-- 4) RLS
-- ----------------------------------------------------------------------------

alter table public.intervention_participants enable row level security;

-- SELECT : admin/manager voient tout. chef_equipe voit sur SES interventions
-- (membre actif de l'équipe affectée) ou sur les interventions dont il est
-- referent. L'utilisateur voit ses propres lignes (RGPD art. 15 — droit d'accès).
create policy ip_select on public.intervention_participants
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or user_id = auth.uid()  -- self-read RGPD
    or public.is_team_member_of_intervention(intervention_id)
    or public.is_referent_of_intervention(intervention_id)
  );

-- INSERT : admin/manager toujours ; chef_equipe seulement sur intervention
-- planned|in_progress de sa team. created_by doit être auth.uid().
create policy ip_insert on public.intervention_participants
  for insert with check (
    created_by = auth.uid()
    and (
      public.current_user_role() in ('admin', 'manager')
      or (
        public.current_user_role() = 'chef_equipe'
        and public.is_team_member_of_intervention(intervention_id)
        and exists (
          select 1 from public.interventions i
          where i.id = intervention_id
            and i.status in ('planned', 'in_progress')
        )
      )
    )
  );

-- DELETE : mêmes conditions que INSERT.
create policy ip_delete on public.intervention_participants
  for delete using (
    public.current_user_role() in ('admin', 'manager')
    or (
      public.current_user_role() = 'chef_equipe'
      and public.is_team_member_of_intervention(intervention_id)
      and exists (
        select 1 from public.interventions i
        where i.id = intervention_id
          and i.status in ('planned', 'in_progress')
      )
    )
  );

-- UPDATE interdit. Pour changer un rôle : DELETE + INSERT (traçable via created_at).

-- ----------------------------------------------------------------------------
-- 5) Trigger immuabilité après completed/validated
-- ----------------------------------------------------------------------------

create or replace function public.tg_freeze_participants_after_completion()
  returns trigger language plpgsql as $$
declare
  s text;
begin
  select status::text into s from public.interventions
    where id = coalesce(new.intervention_id, old.intervention_id);
  if s in ('completed', 'validated')
     and public.current_user_role() <> 'admin' then
    raise exception 'intervention_participants are frozen after intervention status=% (admin override required)', s
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_ip_freeze
  before insert or update or delete on public.intervention_participants
  for each row execute function public.tg_freeze_participants_after_completion();

-- ----------------------------------------------------------------------------
-- 6) activity_logs : verrouillage append-only (recommandation security-privacy)
-- ----------------------------------------------------------------------------

-- L'audit log d'identités exposées (kind=identities_disclosed) ne doit jamais
-- être modifié ni supprimé hors super-admin DBA. On garantit append-only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_logs' and policyname = 'activity_logs_no_update'
  ) then
    create policy activity_logs_no_update on public.activity_logs
      for update using (false) with check (false);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'activity_logs' and policyname = 'activity_logs_no_delete'
  ) then
    create policy activity_logs_no_delete on public.activity_logs
      for delete using (false);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7) Legacy : marquer interventions.team uuid[] comme deprecated
-- ----------------------------------------------------------------------------

comment on column public.interventions.team is
  'DEPRECATED Phase 10 — remplacé par intervention_participants. '
  'Conservé pour compatibilité RLS migration 019 (chef_equipe field RLS). '
  'Backfill prévu migration 025. Drop prévu migration 026 après réécriture 019.';
