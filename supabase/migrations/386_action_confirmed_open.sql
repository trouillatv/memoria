-- Migration 386 : « VÉRIFIÉ : TOUJOURS OUVERT » — une observation durable, deux surfaces.
--
-- Sens métier GELÉ : « Un humain vient de vérifier cette action et confirme qu'elle
-- reste à traiter. » Ni progression, ni réouverture, ni changement d'état — une
-- NOUVELLE OBSERVATION HUMAINE DATÉE. Aujourd'hui « personne n'a revérifié » et
-- « revérifié : toujours ouvert » sont indiscernables ; cet événement les sépare.
--
-- Audit §0 + audit Debrief 2026-09-06 :
--  · markActionProgress = toggle mutable « fait cette fois » (progression) — le
--    détourner aurait menti ; aucun kind existant ne porte cette sémantique ;
--  · le geste terrain `still_open` (watchlist de visite) est l'ancêtre sémantique
--    exact… mais n'écrivait RIEN sur l'action durable. D'où les DEUX surfaces :
--    page Actions (p_source='manual_action_page') et pont watchlist
--    (p_source='visit_watchlist', avec report_id + watchlist_item_id de provenance).
--
-- Neutralité C2A STRUCTURELLE : nativeKindOf() du réducteur renvoie null pour tout
-- kind non lifecycle → confirmed_open est invisible au calcul d'état. Il ne touche
-- PAS lastMeaningfulChangeAt (dérivé des occurrences documentaires) : constater
-- qu'un objet est toujours bloqué n'est pas une progression du chantier.
--
-- Vérité = journal append-only (aucune colonne mutable « last_checked ») ; les
-- read-models dérivent lastHumanVerifiedAt / commentaire / auteur / provenance.

-- 1. Le journal accepte le kind `confirmed_open`.
ALTER TABLE public.site_action_events DROP CONSTRAINT IF EXISTS site_action_events_kind_check;
ALTER TABLE public.site_action_events ADD CONSTRAINT site_action_events_kind_check
  CHECK (kind in ('created','assigned','unassigned','due_date_changed','completed','reopened','cancelled','confirmed_open'));

-- 2. Confirmation ATOMIQUE.
--    · surface Actions (manual_action_page) : commentaire OBLIGATOIRE (l'utilisateur
--      agit hors visite, il dit ce qu'il a constaté) + anti double-clic 10 s ;
--    · pont watchlist (visit_watchlist) : la note de visite sert de constat si
--      présente ; SINON un constat SYSTÈME factuel est écrit et MARQUÉ comme tel
--      (comment_is_system=true) — le fait humain est le clic « toujours ouvert »,
--      le texte généré n'est qu'une restitution technique, il ne devra JAMAIS être
--      présenté comme un commentaire rédigé par l'utilisateur ;
--    · idempotence du pont : UNE observation durable par watchlist_item (un retry
--      réseau ou un aller-retour still_open→checked→still_open dans la même visite
--      ne fabrique pas plusieurs « vérifications humaines ») ; deux visites
--      différentes = deux items = deux événements légitimes ;
--    · objet ACTIF requis (open/planned) : un traité se rouvre d'abord, un écarté
--      se réactive d'abord — jamais de résurrection implicite. AUCUNE mutation.
create or replace function public.fn_confirm_action_open(
  p_id uuid,
  p_actor_id uuid default null,
  p_comment text default null,
  p_source text default 'manual_action_page',
  p_report_id uuid default null,
  p_watchlist_item_id uuid default null
)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.site_actions;
  v_label text;
  v_last timestamptz;
  v_comment text;
  v_is_system boolean := false;
begin
  if p_source not in ('manual_action_page','visit_watchlist') then
    raise exception 'fn_confirm_action_open: source inconnue (%)', p_source;
  end if;
  v_comment := nullif(btrim(coalesce(p_comment, '')), '');
  if v_comment is null then
    if p_source = 'manual_action_page' then
      raise exception 'fn_confirm_action_open: commentaire de vérification requis';
    end if;
    v_comment := 'Constaté « toujours ouvert » lors de la visite du '
      || to_char(now() at time zone 'Pacific/Noumea', 'DD/MM/YYYY') || '.';
    v_is_system := true;
  end if;

  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  if v.status not in ('open','planned') then
    raise exception 'fn_confirm_action_open: objet non actif (%) — rouvrir/réactiver d''abord', v.status;
  end if;

  if p_watchlist_item_id is not null then
    -- Idempotence de provenance : une seule observation durable par item de watchlist.
    if exists (
      select 1 from public.site_action_events
      where action_id = p_id and kind = 'confirmed_open'
        and after_value->>'watchlist_item_id' = p_watchlist_item_id::text
    ) then
      return v.site_id;
    end if;
  else
    -- Anti double-clic UNIQUEMENT (10 s) : deux vraies vérifications à des moments
    -- différents restent deux événements légitimes.
    select max(occurred_at) into v_last from public.site_action_events
      where action_id = p_id and kind = 'confirmed_open';
    if v_last is not null and v_last > now() - interval '10 seconds' then
      return v.site_id;
    end if;
  end if;

  v_label := (select full_name from public.users where id = p_actor_id);
  insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value, after_value, reason)
  values (p_id, v.site_id, 'confirmed_open', p_actor_id, v_label,
          jsonb_build_object('status', v.status),
          jsonb_strip_nulls(jsonb_build_object(
            'source', p_source,
            'comment_is_system', v_is_system,
            'report_id', p_report_id,
            'watchlist_item_id', p_watchlist_item_id)),
          v_comment);
  return v.site_id;
end $$;
