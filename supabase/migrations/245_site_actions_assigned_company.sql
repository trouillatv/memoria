-- =============================================================================
-- 245 — Une action peut être portée par une ENTREPRISE (Lot 2B.1, 2026-07-27).
--
-- Sur le terrain, le responsable est parfois connu au niveau ENTREPRISE avant
-- d'avoir un nom (« ETV doit reprendre le garde-corps »). Forcer une personne
-- produirait une fausse précision. On ajoute donc une responsabilité au niveau
-- le plus précis réellement connu :
--   site_actions.assigned_company_id -> companies(id)
--
-- Doctrine : entreprise ET/OU personne, jamais une abstraction polymorphe.
--   assigned_company_id = organisation responsable ;
--   assigned_contact_id = personne référente / responsable opérationnelle.
-- Au moins l'un des deux, facultativement ; une action sans responsable reste
-- un état métier valide.
--
-- ADDITIF, nullable, SANS backfill. ON DELETE SET NULL : l'action survit à la
-- disparition de l'entreprise (comme pour le contact, mig 220). `assigned_to`
-- (texte) reste un fallback historique — jamais une 3ᵉ vérité concurrente.
-- Portée STRICTEMENT limitée aux actions : réserves/décisions/échéances feront
-- l'objet d'une analyse métier distincte, pas d'une symétrie artificielle.
-- =============================================================================

alter table public.site_actions
  add column if not exists assigned_company_id uuid
    references public.companies(id) on delete set null;

-- Lecture « actions d'une entreprise » (tous chantiers) et « … sur CE chantier ».
create index if not exists sa_assigned_company_idx
  on public.site_actions (assigned_company_id, site_id)
  where assigned_company_id is not null;

-- INVARIANT TENANT garanti par la BASE (service_role bypasse la RLS). L'entreprise
-- responsable doit appartenir à la MÊME organisation que le chantier. On ne
-- vérifie PAS l'appartenance au casting actif : une action historique conserve
-- son entreprise même si celle-ci quitte le casting (le sélecteur, lui, est
-- strict). Même motif de garde qu'à l'INSERT ou au vrai changement de valeur.
create or replace function public.check_site_action_company_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_site_org        uuid;
  v_company_org     uuid;
  v_company_deleted timestamptz;
  v_company_placeholder boolean;
begin
  if new.assigned_company_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_company_id is not distinct from old.assigned_company_id then
    return new;
  end if;

  select organization_id into v_site_org
    from public.sites where id = new.site_id;
  select organization_id, deleted_at, is_placeholder
    into v_company_org, v_company_deleted, v_company_placeholder
    from public.companies where id = new.assigned_company_id;

  if v_company_org is null or v_site_org is null or v_company_org is distinct from v_site_org then
    raise exception 'site_actions: l''entreprise responsable (%) doit appartenir a la meme organisation que le chantier', new.assigned_company_id;
  end if;
  if v_company_deleted is not null then
    raise exception 'site_actions: cette entreprise est archivee, elle ne peut pas recevoir de nouvelle attribution';
  end if;
  -- L'entreprise « À identifier » (placeholder) n'est jamais un responsable.
  if v_company_placeholder then
    raise exception 'site_actions: l''entreprise « a identifier » ne peut pas etre responsable d''une action';
  end if;

  return new;
end $$;

drop trigger if exists trg_site_actions_company_org on public.site_actions;
create trigger trg_site_actions_company_org
  before insert or update on public.site_actions
  for each row execute function public.check_site_action_company_org();

-- ── fn_update_action : forwarder assigned_company_id (le RPC liste les colonnes) ──
-- Re-création à l'identique de la mig 221 + UNE ligne (assigned_company_id).
create or replace function public.fn_update_action(p_id uuid, p_patch jsonb, p_actor_id uuid default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.site_actions;
  v_label text;
  v_new_contact uuid;
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
