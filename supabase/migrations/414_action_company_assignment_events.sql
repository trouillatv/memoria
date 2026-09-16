-- =============================================================================
-- 414 — Journaliser l'attribution/retrait d'ENTREPRISE responsable (site_actions).
--
-- Constat (audit protection humaine, P0-B.2, Vincent 2026-09-17) : fn_update_action
-- journalise déjà assigned_contact_id (assigned/unassigned) et due_date
-- (due_date_changed), mais assigned_company_id ne produit AUCUN événement.
-- Conséquence concrète : la réconciliation Action-CBO (mig 413) protège déjà un
-- retrait humain explicite de contact ou d'échéance (site_action_events consulté),
-- mais ne peut PAS distinguer « entreprise jamais renseignée » de « entreprise
-- explicitement retirée par un humain » — un doublon plus ancien pourrait donc
-- re-remplir silencieusement une entreprise volontairement retirée.
--
-- Fix additif, mirror exact du bloc contact existant (mig 245) : clé jsonb
-- `company_id` (jamais `contact_id`, pour ne pas se confondre à la lecture).
-- Réutilise les kinds 'assigned'/'unassigned' déjà autorisés (mig 221), aucun
-- changement de contrainte. Recréation à l'identique de fn_update_action
-- (mig 245) + le bloc entreprise.
-- =============================================================================

create or replace function public.fn_update_action(p_id uuid, p_patch jsonb, p_actor_id uuid default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.site_actions;
  v_label text;
  v_new_contact uuid;
  v_new_company uuid;
  v_new_due date;
  v_new_due_status text;
begin
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  v_label := (select full_name from public.users where id = p_actor_id);

  update public.site_actions set
    title               = case when p_patch ? 'title'               then (p_patch->>'title')                    else title end,
    body                = case when p_patch ? 'body'                then (p_patch->>'body')                     else body end,
    assigned_to         = case when p_patch ? 'assigned_to'         then (p_patch->>'assigned_to')              else assigned_to end,
    assigned_contact_id = case when p_patch ? 'assigned_contact_id' then (p_patch->>'assigned_contact_id')::uuid else assigned_contact_id end,
    assigned_company_id = case when p_patch ? 'assigned_company_id' then (p_patch->>'assigned_company_id')::uuid else assigned_company_id end,
    corps_etat          = case when p_patch ? 'corps_etat'          then (p_patch->>'corps_etat')               else corps_etat end,
    due_date            = case when p_patch ? 'due_date'            then (p_patch->>'due_date')::date           else due_date end,
    due_date_status     = case when p_patch ? 'due_date_status'     then (p_patch->>'due_date_status')          else due_date_status end,
    status              = case when p_patch ? 'status'              then (p_patch->>'status')                   else status end,
    kind                = case when p_patch ? 'kind'                then (p_patch->>'kind')                     else kind end
  where id = p_id;

  -- Attribution personne : seulement si assigned_contact_id change vraiment.
  if p_patch ? 'assigned_contact_id' then
    v_new_contact := (p_patch->>'assigned_contact_id')::uuid;
    if v_new_contact is distinct from v.assigned_contact_id then
      if v_new_contact is not null then
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, after_value)
        values (p_id, v.site_id, 'assigned', p_actor_id, v_label,
                jsonb_build_object('contact_id', v_new_contact,
                                   'label', (select full_name from public.company_contacts where id = v_new_contact)));
      else
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value)
        values (p_id, v.site_id, 'unassigned', p_actor_id, v_label,
                jsonb_build_object('contact_id', v.assigned_contact_id,
                                   'label', (select full_name from public.company_contacts where id = v.assigned_contact_id)));
      end if;
    end if;
  end if;

  -- Attribution entreprise : même garde que le contact (P0-B.2, gap comblé).
  if p_patch ? 'assigned_company_id' then
    v_new_company := (p_patch->>'assigned_company_id')::uuid;
    if v_new_company is distinct from v.assigned_company_id then
      if v_new_company is not null then
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, after_value)
        values (p_id, v.site_id, 'assigned', p_actor_id, v_label,
                jsonb_build_object('company_id', v_new_company,
                                   'label', (select name from public.companies where id = v_new_company)));
      else
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value)
        values (p_id, v.site_id, 'unassigned', p_actor_id, v_label,
                jsonb_build_object('company_id', v.assigned_company_id,
                                   'label', (select name from public.companies where id = v.assigned_company_id)));
      end if;
    end if;
  end if;

  -- Échéance : seulement si due_date change vraiment.
  if p_patch ? 'due_date' then
    v_new_due := (p_patch->>'due_date')::date;
    if v_new_due is distinct from v.due_date then
      v_new_due_status := case when p_patch ? 'due_date_status' then (p_patch->>'due_date_status') else v.due_date_status end;
      insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value, after_value)
      values (p_id, v.site_id, 'due_date_changed', p_actor_id, v_label,
              jsonb_build_object('date', v.due_date, 'status', v.due_date_status),
              jsonb_build_object('date', v_new_due, 'status', v_new_due_status));
    end if;
  end if;

  return v.site_id;
end $$;
