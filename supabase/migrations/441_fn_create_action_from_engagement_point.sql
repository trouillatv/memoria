-- Migration 441 : « Traiter un point » ATOMIQUE (FIX_REQUIRED review ChatGPT sur c05469a7)
--
-- Défaut corrigé : le chemin applicatif créait le site_action, PUIS le rapprochement
-- P0-4B, PUIS la qualification P0-4C en TROIS requêtes séparées. Un échec à l'étape 2
-- ou 3 laissait une Action orpheline (créée, jamais rapprochée/qualifiée) — l'utilisateur
-- n'a jamais demandé une Action orpheline en cliquant « Créer l'action ».
--
-- Correctif : une fonction plpgsql est atomique — Action + lien + qualification vivent
-- dans la MÊME transaction. Tout échec (statut Engagement, contrainte CHECK de
-- qualification, etc.) provoque le rollback INTÉGRAL : aucune des trois lignes n'est
-- visible. Jamais de compensation par DELETE après coup.
--
-- Revalidation en base (défense en profondeur, indépendante des vérifications déjà
-- faites côté serveur par createActionFromEngagementAction) : Engagement toujours
-- 'active', même site_id, même organisation. Ferme la fenêtre de course entre la
-- lecture initiale de l'Engagement et l'écriture.
--
-- organization_id de site_actions n'est PAS fourni ici : dérivé par le trigger M2A
-- existant trg_force_org (migration 234) depuis site_id, comme tout autre insert dans
-- cette table. site_action_engagement_links et site_action_engagement_link_events
-- n'ont pas d'équivalent — organization_id y est posé explicitement et revalidé.
--
-- Additif et idempotent : CREATE OR REPLACE FUNCTION. Aucune donnée existante touchée.

create or replace function public.fn_create_action_from_engagement_point(
  p_engagement_id   uuid,
  p_site_id         uuid,
  p_organization_id uuid,
  p_title           text,
  p_qualification   text,
  p_note            text,
  p_created_by      uuid
) returns table(action_id uuid, link_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_engagement public.engagements;
  v_site       public.sites;
  v_action_id  uuid;
  v_link_id    uuid;
begin
  select * into v_engagement from public.engagements where id = p_engagement_id for update;
  if not found then
    raise exception 'fn_create_action_from_engagement_point: engagement introuvable (%)', p_engagement_id;
  end if;
  if v_engagement.status <> 'active' then
    raise exception 'fn_create_action_from_engagement_point: engagement non actif (%)', p_engagement_id;
  end if;
  if v_engagement.site_id is null or v_engagement.site_id <> p_site_id then
    raise exception 'fn_create_action_from_engagement_point: site_id incohérent avec l''engagement (%)', p_engagement_id;
  end if;
  if v_engagement.organization_id <> p_organization_id then
    raise exception 'fn_create_action_from_engagement_point: organisation incohérente avec l''engagement (%)', p_engagement_id;
  end if;

  select * into v_site from public.sites where id = p_site_id;
  if not found or v_site.organization_id <> p_organization_id then
    raise exception 'fn_create_action_from_engagement_point: site incohérent avec l''organisation (%)', p_site_id;
  end if;

  insert into public.site_actions (site_id, title, created_by, created_from, kind, status)
  values (p_site_id, p_title, p_created_by, 'engagement_treat_point', 'one_shot', 'open')
  returning id into v_action_id;

  insert into public.site_action_engagement_links (organization_id, site_id, site_action_id, engagement_id, created_by)
  values (p_organization_id, p_site_id, v_action_id, p_engagement_id, p_created_by)
  returning id into v_link_id;

  -- La contrainte CHECK existante (migration 440) refuse toute qualification hors
  -- des 4 valeurs P0-4C : aucune revalidation applicative dupliquée ici, l'échec de
  -- cet insert fait rollback les deux inserts précédents (même transaction).
  insert into public.site_action_engagement_link_events (organization_id, link_id, qualification, note, created_by)
  values (p_organization_id, v_link_id, p_qualification, p_note, p_created_by);

  return query select v_action_id, v_link_id;
end;
$$;
