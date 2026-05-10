-- Migration 019 : permettre aux chef_equipe (= agents terrain) d'exécuter
-- les interventions où leur uuid est dans interventions.team[].
--
-- Spec : docs/superpowers/specs/2026-05-10-field-agent-app-design.md (Phase 3)
-- Slice 3.0 — fondation auth/RLS pour la route /m

-- ==========================================
-- interventions : chef_equipe peut update SEULEMENT ses propres interventions
-- ==========================================
drop policy if exists "interventions chef_equipe self update" on public.interventions;
create policy "interventions chef_equipe self update" on public.interventions
  for update
  using (
    public.current_user_role() = 'chef_equipe'
    and auth.uid() = any(team)
  )
  with check (
    public.current_user_role() = 'chef_equipe'
    and auth.uid() = any(team)
  );

-- ==========================================
-- intervention_checklist_items : chef_equipe peut cocher/décocher SEULEMENT
-- les items des interventions où il est dans team[]
-- ==========================================
drop policy if exists "intervention_checklist_items chef_equipe write" on public.intervention_checklist_items;
create policy "intervention_checklist_items chef_equipe write" on public.intervention_checklist_items
  for all
  using (
    public.current_user_role() = 'chef_equipe'
    and exists (
      select 1 from public.interventions i
      where i.id = intervention_id
      and auth.uid() = any(i.team)
    )
  )
  with check (
    public.current_user_role() = 'chef_equipe'
    and exists (
      select 1 from public.interventions i
      where i.id = intervention_id
      and auth.uid() = any(i.team)
    )
  );

-- ==========================================
-- intervention_photos : chef_equipe peut INSERT seulement pour ses interventions
-- ==========================================
drop policy if exists "intervention_photos chef_equipe insert" on public.intervention_photos;
create policy "intervention_photos chef_equipe insert" on public.intervention_photos
  for insert
  with check (
    public.current_user_role() = 'chef_equipe'
    and exists (
      select 1 from public.interventions i
      where i.id = intervention_id
      and auth.uid() = any(i.team)
    )
  );

-- ==========================================
-- intervention_anomalies : chef_equipe peut INSERT pour ses interventions
-- ==========================================
drop policy if exists "intervention_anomalies chef_equipe insert" on public.intervention_anomalies;
create policy "intervention_anomalies chef_equipe insert" on public.intervention_anomalies
  for insert
  with check (
    public.current_user_role() = 'chef_equipe'
    and exists (
      select 1 from public.interventions i
      where i.id = intervention_id
      and auth.uid() = any(i.team)
    )
  );

-- Note : pas de policy chef_equipe sur intervention_validations.
-- Validation reste réservée aux admin/manager (déjà couvert par migration 018).
