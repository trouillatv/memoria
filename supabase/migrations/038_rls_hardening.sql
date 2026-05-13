-- Migration 038 — Durcissement RLS (audit sécurité 2026-05-13).
--
-- Problèmes identifiés :
--   1. SELECT « auth.role() = authenticated » trop large sur interventions*,
--      sites, site_notes — un chef_equipe pouvait lire toutes les anomalies,
--      tous les codes d'accès, etc.
--   2. UPDATE chef_equipe sur interventions sans restriction de colonne —
--      un chef pouvait s'auto-valider, modifier team, antidater.
--   3. Bucket tender-documents accessible à tout authentifié — chefs d'équipe
--      pouvaient télécharger les AO clients.
--
-- Convention service_role : toutes ces policies sont contournées par le
-- service role key (admin client). L'application n'est donc PAS cassée par
-- ces durcissements ; ils protègent contre l'éventualité où la couche lib/db/
-- migrerait vers le server client (RLS appliquée).

-- =============================================================================
-- 1. Sites — restreindre la lecture (notamment access_code/alarm_code)
-- =============================================================================

drop policy if exists "sites auth read" on public.sites;
drop policy if exists "sites authenticated read" on public.sites;

create policy "sites authorized read" on public.sites
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1
      from public.missions m
      join public.interventions i on i.mission_id = m.id
      where m.site_id = sites.id
        and m.deleted_at is null
        and auth.uid() = any(i.team)
    )
  );

-- =============================================================================
-- 2. Site notes — restreindre la lecture par appartenance équipe au site
-- =============================================================================

drop policy if exists "authenticated read site_notes" on public.site_notes;
drop policy if exists "site_notes auth read" on public.site_notes;

create policy "site_notes authorized read" on public.site_notes
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1
      from public.missions m
      join public.interventions i on i.mission_id = m.id
      where m.site_id = site_notes.site_id
        and m.deleted_at is null
        and auth.uid() = any(i.team)
    )
  );

-- =============================================================================
-- 3. Interventions — chef ne voit que ses interventions (team[])
-- =============================================================================

drop policy if exists "interventions auth read" on public.interventions;

create policy "interventions authorized read" on public.interventions
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or auth.uid() = any(team)
  );

-- =============================================================================
-- 4. Intervention children (checklist, photos, anomalies, validations)
-- =============================================================================

drop policy if exists "intervention_checklist_items auth read" on public.intervention_checklist_items;
create policy "intervention_checklist_items authorized read" on public.intervention_checklist_items
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1 from public.interventions i
      where i.id = intervention_id and auth.uid() = any(i.team)
    )
  );

drop policy if exists "intervention_photos auth read" on public.intervention_photos;
create policy "intervention_photos authorized read" on public.intervention_photos
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1 from public.interventions i
      where i.id = intervention_id and auth.uid() = any(i.team)
    )
  );

drop policy if exists "intervention_anomalies auth read" on public.intervention_anomalies;
create policy "intervention_anomalies authorized read" on public.intervention_anomalies
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1 from public.interventions i
      where i.id = intervention_id and auth.uid() = any(i.team)
    )
  );

drop policy if exists "intervention_validations auth read" on public.intervention_validations;
create policy "intervention_validations authorized read" on public.intervention_validations
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or exists (
      select 1 from public.interventions i
      where i.id = intervention_id and auth.uid() = any(i.team)
    )
  );

-- =============================================================================
-- 5. Trigger column-guard sur interventions UPDATE pour chef_equipe.
--
-- Empêche :
--   - modifier team / assigned_team_id / mission_id (= s'inviter ailleurs)
--   - antidater (scheduled_at, scheduled_for)
--   - s'auto-valider (status=validated)
--   - modifier template_id, created_at, created_by
-- Autorisé : status (sauf →validated), notes, executed_at, skipped_*.
--
-- Bypass : si auth.jwt() est null (service_role / scripts), pas de check.
-- =============================================================================

create or replace function public.interventions_chef_equipe_column_guard()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Bypass : connexions service_role (admin client) ou non authentifiées.
  if auth.jwt() is null then
    return new;
  end if;

  -- Seul le rôle chef_equipe est contraint en colonnes.
  if public.current_user_role() <> 'chef_equipe' then
    return new;
  end if;

  -- Colonnes structurelles : OLD wins.
  new.mission_id := old.mission_id;
  new.team := old.team;
  new.assigned_team_id := old.assigned_team_id;
  new.scheduled_at := old.scheduled_at;
  new.scheduled_for := old.scheduled_for;
  new.slot := old.slot;
  new.template_id := old.template_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  -- Auto-validation interdite : un chef ne peut pas faire passer
  -- status à 'validated'. Doctrine : validation = manager.
  if old.status is distinct from 'validated' and new.status = 'validated' then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists interventions_chef_equipe_column_guard on public.interventions;
create trigger interventions_chef_equipe_column_guard
  before update on public.interventions
  for each row execute function public.interventions_chef_equipe_column_guard();

-- =============================================================================
-- 6. Buckets sensibles — réservés aux admin/manager
-- =============================================================================

drop policy if exists "tender-documents read for authenticated" on storage.objects;
create policy "tender-documents read for managers"
  on storage.objects for select
  using (bucket_id = 'tender-documents' and public.current_user_role() in ('admin', 'manager'));

drop policy if exists "library-documents read for authenticated" on storage.objects;
create policy "library-documents read for managers"
  on storage.objects for select
  using (bucket_id = 'library-documents' and public.current_user_role() in ('admin', 'manager'));

drop policy if exists "report-pdfs read for authenticated" on storage.objects;
create policy "report-pdfs read for managers"
  on storage.objects for select
  using (bucket_id = 'report-pdfs' and public.current_user_role() in ('admin', 'manager'));

-- Note : intervention-photos reste en « authenticated read » côté bucket —
-- les paths sont déjà protégés par la RLS sur la table intervention_photos
-- (cf. section 4). Un chef ne peut pas énumérer les paths qu'il n'a pas droit
-- de voir, et le storage_path inclut une part aléatoire (32 chars) non
-- devinable.
