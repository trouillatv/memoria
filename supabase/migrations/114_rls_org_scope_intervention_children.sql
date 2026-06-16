-- =============================================================================
-- 114 — SÉCURITÉ MULTI-TENANT : fermeture d'une fuite cross-org confirmée
-- (audit board 2026-06-17).
--
-- Les policies RLS SELECT des tables ENFANTS d'interventions (checklist_items,
-- photos, anomalies, validations) étaient ROLE-ONLY (mig 038) — sans filtre
-- organization_id. Un admin/manager d'une AUTRE organisation pouvait donc lire
-- photos / anomalies / checklists / validations d'une autre entreprise. La
-- migration 089 (multi-tenant) avait ajouté organization_id sur les tables
-- racines mais OUBLIÉ ces tables enfants.
--
-- Ce correctif (défense-en-profondeur — l'app passe par le service-role qui
-- bypass la RLS + un scoping applicatif, donc AUCUNE régression attendue) :
--   1. dénormalise organization_id sur ces 4 tables ;
--   2. backfill depuis l'intervention parente ;
--   3. trigger qui le pose à l'INSERT (l'app n'a rien à changer) ;
--   4. index pour le filtre ;
--   5. réécrit les policies SELECT : organization_id = current_user_org_id()
--      D'ABORD, puis la logique rôle/équipe existante (inchangée) DANS l'org.
--
-- VÉRIF après application (devrait renvoyer 0) : depuis une session authentifiée
-- d'une org A, `select count(*) from intervention_photos where organization_id
-- <> current_user_org_id();`
-- =============================================================================

-- 1. Colonne organization_id (dénormalisée depuis l'intervention parente).
alter table public.intervention_checklist_items add column if not exists organization_id uuid references public.organizations(id);
alter table public.intervention_photos          add column if not exists organization_id uuid references public.organizations(id);
alter table public.intervention_anomalies       add column if not exists organization_id uuid references public.organizations(id);
alter table public.intervention_validations     add column if not exists organization_id uuid references public.organizations(id);

-- 2. Backfill depuis l'intervention parente (idempotent : seulement les null).
update public.intervention_checklist_items c set organization_id = i.organization_id
  from public.interventions i where c.intervention_id = i.id and c.organization_id is null;
update public.intervention_photos c set organization_id = i.organization_id
  from public.interventions i where c.intervention_id = i.id and c.organization_id is null;
update public.intervention_anomalies c set organization_id = i.organization_id
  from public.interventions i where c.intervention_id = i.id and c.organization_id is null;
update public.intervention_validations c set organization_id = i.organization_id
  from public.interventions i where c.intervention_id = i.id and c.organization_id is null;

-- 3. Trigger : poser organization_id à l'INSERT depuis l'intervention parente.
--    security definer pour lire interventions quel que soit le rôle inséreur.
create or replace function public.set_intervention_child_org()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.organization_id is null then
    select i.organization_id into new.organization_id
    from public.interventions i
    where i.id = new.intervention_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_org on public.intervention_checklist_items;
create trigger trg_set_org before insert on public.intervention_checklist_items
  for each row execute function public.set_intervention_child_org();
drop trigger if exists trg_set_org on public.intervention_photos;
create trigger trg_set_org before insert on public.intervention_photos
  for each row execute function public.set_intervention_child_org();
drop trigger if exists trg_set_org on public.intervention_anomalies;
create trigger trg_set_org before insert on public.intervention_anomalies
  for each row execute function public.set_intervention_child_org();
drop trigger if exists trg_set_org on public.intervention_validations;
create trigger trg_set_org before insert on public.intervention_validations
  for each row execute function public.set_intervention_child_org();

-- 4. Index pour le filtre RLS.
create index if not exists idx_intervention_checklist_items_org on public.intervention_checklist_items(organization_id);
create index if not exists idx_intervention_photos_org          on public.intervention_photos(organization_id);
create index if not exists idx_intervention_anomalies_org       on public.intervention_anomalies(organization_id);
create index if not exists idx_intervention_validations_org     on public.intervention_validations(organization_id);

-- 5. Policies SELECT réécrites : ORG d'abord, puis rôle/équipe (inchangé) DANS l'org.
drop policy if exists "intervention_checklist_items authorized read" on public.intervention_checklist_items;
create policy "intervention_checklist_items authorized read" on public.intervention_checklist_items
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from public.interventions i
        where i.id = intervention_id and auth.uid() = any(i.team)
      )
    )
  );

drop policy if exists "intervention_photos authorized read" on public.intervention_photos;
create policy "intervention_photos authorized read" on public.intervention_photos
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from public.interventions i
        where i.id = intervention_id and auth.uid() = any(i.team)
      )
    )
  );

drop policy if exists "intervention_anomalies authorized read" on public.intervention_anomalies;
create policy "intervention_anomalies authorized read" on public.intervention_anomalies
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from public.interventions i
        where i.id = intervention_id and auth.uid() = any(i.team)
      )
    )
  );

drop policy if exists "intervention_validations authorized read" on public.intervention_validations;
create policy "intervention_validations authorized read" on public.intervention_validations
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from public.interventions i
        where i.id = intervention_id and auth.uid() = any(i.team)
      )
    )
  );
