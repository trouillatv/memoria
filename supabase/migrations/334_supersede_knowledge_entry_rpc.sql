-- Migration 334 — P5-F2a : supersession atomique d'une site_knowledge_entries.
--
-- Cadrage Vincent (2026-08-17) : une supersession doit garantir « soit la
-- nouvelle connaissance existe et l'ancienne est supersédée, soit rien ne
-- change ». Deux appels JS successifs (insert puis update) ne peuvent pas
-- garantir cet invariant — d'où une fonction transactionnelle, sur le modèle
-- de merge_canonical_subjects (mig 311) et record_share_access (mig 042).
--
-- Gardes (toutes bloquantes, aucune silencieuse) :
--   * l'ancienne entrée doit exister et être 'active' — jamais de double
--     remplacement d'une entrée déjà superseded/archived ;
--   * l'ancienne entrée doit être 'current_information' — durable_knowledge
--     n'entre pas dans ce mécanisme en V1 (correction Vincent) ;
--   * organization_id/site_id passés par l'appelant DOIVENT correspondre à
--     ceux de l'ancienne entrée — la fonction ne fait pas confiance à un
--     organization_id arbitrairement fourni, même si le serveur a déjà
--     vérifié l'accès en amont (défense en profondeur) ;
--   * new.supersedes_id = old.id, systématique.
--
-- Seul le service_role peut l'exécuter (appelée uniquement par
-- supersedeKnowledgeEntry() côté admin client, jamais depuis une session
-- utilisateur) — search_path fixé explicitement (SECURITY DEFINER).

create or replace function public.supersede_knowledge_entry(
  p_old_entry_id uuid,
  p_organization_id uuid,
  p_site_id uuid,
  p_title text,
  p_body text,
  p_source_report_id uuid,
  p_confirmed_by uuid,
  p_copilot_proposal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old record;
  v_new_id uuid;
begin
  select id, organization_id, site_id, kind, status
    into v_old
    from public.site_knowledge_entries
    where id = p_old_entry_id
    for update;

  if not found then
    raise exception 'supersede_knowledge_entry: entrée introuvable (%)', p_old_entry_id;
  end if;

  if v_old.status <> 'active' then
    raise exception 'supersede_knowledge_entry: entrée non active (status=%), déjà supersédée ou archivée', v_old.status;
  end if;

  if v_old.kind <> 'current_information' then
    raise exception 'supersede_knowledge_entry: seule current_information peut être supersédée en V1 (kind=%)', v_old.kind;
  end if;

  if v_old.organization_id <> p_organization_id or v_old.site_id <> p_site_id then
    raise exception 'supersede_knowledge_entry: organization_id/site_id ne correspondent pas à l''entrée ciblée (%)', p_old_entry_id;
  end if;

  insert into public.site_knowledge_entries (
    organization_id, site_id, kind, status, title, body,
    source_report_id, confirmed_by, copilot_proposal_id, supersedes_id
  ) values (
    p_organization_id, p_site_id, 'current_information', 'active', p_title, p_body,
    p_source_report_id, p_confirmed_by, p_copilot_proposal_id, p_old_entry_id
  )
  returning id into v_new_id;

  update public.site_knowledge_entries
    set status = 'superseded', valid_until = now(), updated_at = now()
    where id = p_old_entry_id;

  return v_new_id;
end;
$$;

comment on function public.supersede_knowledge_entry(uuid, uuid, uuid, text, text, uuid, uuid, uuid) is
  'P5-F2a : remplace atomiquement une current_information active par une nouvelle entrée (supersedes_id), jamais de double remplacement silencieux.';

-- Supabase accorde EXECUTE à anon/authenticated par défaut (ALTER DEFAULT
-- PRIVILEGES) sur toute nouvelle fonction du schéma public — "revoke ... from
-- public" seul ne suffit pas à retirer ces droits déjà en place à la création.
-- Révocation explicite de chaque rôle client, aucune n'est implicite.
revoke all on function public.supersede_knowledge_entry(uuid, uuid, uuid, text, text, uuid, uuid, uuid) from public;
revoke all on function public.supersede_knowledge_entry(uuid, uuid, uuid, text, text, uuid, uuid, uuid) from anon;
revoke all on function public.supersede_knowledge_entry(uuid, uuid, uuid, text, text, uuid, uuid, uuid) from authenticated;
grant execute on function public.supersede_knowledge_entry(uuid, uuid, uuid, text, text, uuid, uuid, uuid) to service_role;
