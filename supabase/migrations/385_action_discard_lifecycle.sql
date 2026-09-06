-- Migration 385 : geste métier « ÉCARTER » — lifecycle propre, append-only.
--
-- Constat (audit gestes 2026-09-06) : `cancelSiteAction` faisait un UPDATE brut
-- status='cancelled' SANS événement, SANS timestamp, SANS motif — l'objet
-- disparaissait du backlog sans que la vérité durable (site_action_events → C2A)
-- l'enregistre. C'est exactement le raccourci que le journal (mig 221) interdit.
--
-- Sémantique : Écarter ≠ Traiter. « Cet objet ne doit pas être piloté »
-- (doublon, non applicable, hors périmètre, autre) — jamais « c'est fait ».
-- Le réducteur C2A mappe déjà cancelled → native_cancelled (terminal, jamais
-- completed — D2, mig-level testé) : AUCUNE nouvelle heuristique.
--
-- Réversibilité : un écart humain peut être erroné. fn_reopen_action accepte
-- désormais aussi status='cancelled' (Réactiver) — l'événement `reopened`
-- conserve dans before_value l'état d'où l'on revient. L'histoire ne se
-- réécrit jamais : écarter puis réactiver laisse DEUX événements.
--
-- Additif : aucune ligne existante modifiée (le CHECK est élargi, jamais réduit).

-- 1. Le journal accepte le kind `cancelled`.
ALTER TABLE public.site_action_events DROP CONSTRAINT IF EXISTS site_action_events_kind_check;
ALTER TABLE public.site_action_events ADD CONSTRAINT site_action_events_kind_check
  CHECK (kind in ('created','assigned','unassigned','due_date_changed','completed','reopened','cancelled'));

-- 2. Écart ATOMIQUE — motif fermé + commentaire OBLIGATOIRES, garantis EN BASE.
--    No-op si déjà écartée (idempotent) ; refus silencieux si traitée (un « done »
--    ne s'écarte pas : il se rouvre d'abord — pas de raccourci d'état).
create or replace function public.fn_cancel_action(
  p_id uuid,
  p_actor_id uuid default null,
  p_motif text default null,
  p_comment text default null
)
returns uuid language plpgsql set search_path = '' as $$
declare v public.site_actions; v_label text;
begin
  if p_motif is null or p_motif not in ('doublon','non_applicable','hors_perimetre','autre') then
    raise exception 'fn_cancel_action: motif requis (doublon|non_applicable|hors_perimetre|autre)';
  end if;
  if p_comment is null or length(btrim(p_comment)) = 0 then
    raise exception 'fn_cancel_action: commentaire requis';
  end if;
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  if v.status = 'cancelled' then return v.site_id; end if;
  if v.status = 'done' then return v.site_id; end if;
  v_label := (select full_name from public.users where id = p_actor_id);
  update public.site_actions set status = 'cancelled' where id = p_id;
  insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value, after_value, reason)
  values (p_id, v.site_id, 'cancelled', p_actor_id, v_label,
          jsonb_build_object('status', v.status),
          jsonb_build_object('motif', p_motif),
          p_comment);
  return v.site_id;
end $$;

-- 3. Réactivation : fn_reopen_action accepte done ET cancelled. before_value
--    conserve l'état quitté (la réouverture d'un traité et la réactivation d'un
--    écart restent distinguables dans le journal, sans nouveau kind — le
--    réducteur C2A traite déjà `reopened` comme un retour à l'actif).
create or replace function public.fn_reopen_action(p_id uuid, p_actor_id uuid default null, p_reason text default null)
returns uuid language plpgsql set search_path = '' as $$
declare v public.site_actions; v_label text;
begin
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  if v.status not in ('done','cancelled') then return v.site_id; end if;
  v_label := (select full_name from public.users where id = p_actor_id);
  update public.site_actions set status='open', done_at=null where id=p_id;
  insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value, reason)
  values (p_id, v.site_id, 'reopened', p_actor_id, v_label, jsonb_build_object('status', v.status), p_reason);
  return v.site_id;
end $$;
