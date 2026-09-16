-- 413 — Réconciliation post-CBO des Actions longitudinales (P0-B, arbitrage Vincent 2026-09-17).
--
-- Constat (audit stabilisation Dumbéa Mall après 2 PV) : la résolution d'identité
-- canonical_business_object (CBO) fonctionne déjà très bien — deux Actions issues
-- de PV différents pour la même obligation finissent avec le même CBO (déterministe
-- ET llm). Mais materialize_historical_visit() (mig 374) insère une nouvelle ligne
-- site_actions à chaque proposition, sans jamais vérifier l'existence d'une Action
-- représentant déjà la même obligation. Décision explicite de Vincent : PAS de
-- déduplication lexicale/synchrone dans le RPC de matérialisation (ce serait un
-- second moteur d'identité, plus faible que le CBO qui couvre déjà les cas LLM).
-- La réconciliation a lieu APRÈS résolution CBO, dans le pipeline de post-traitement.
--
-- Doctrine : « Une occurrence documentaire peut créer une proposition, mais une
-- fois que deux propositions sont reconnues comme appartenant au même CBO, elles
-- ne doivent pas laisser deux Actions opérationnelles actives représentant la même
-- obligation. » Une Action gagnante (la plus ancienne) reste ouverte et pilotable ;
-- les autres deviennent superseded — jamais DELETE, jamais perte de la trace de
-- l'occurrence/preuve source (report_id, document_proposal_materialization inchangés).
--
-- Réutilise le lifecycle existant : superseded_by/superseded_at (mig 319, jusqu'ici
-- posés en base mais jamais consommés) + le motif 'doublon' et le kind 'cancelled'
-- déjà acceptés par site_action_events (mig 385, geste humain « Écarter »). La
-- lecture (listes actives filtrées sur status IN ('open','planned')) exclut donc
-- immédiatement les Actions réconciliées, sans aucun changement de read-model.
--
-- Réversible : fn_reopen_action accepte déjà status='cancelled' — une réconciliation
-- erronée se répare par une réouverture humaine normale (avant_value au journal
-- conserve superseded_by pour audit, la colonne superseded_by elle-même n'est PAS
-- remise à null par une réouverture : elle documente l'historique, pas l'état courant).
--
-- Additif : aucune colonne ni contrainte modifiée, une seule fonction créée.

create or replace function public.fn_supersede_action_by_cbo(
  p_loser_id uuid,
  p_winner_id uuid,
  p_actor_id uuid default null
)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.site_actions;
  v_label text;
begin
  if p_loser_id = p_winner_id then
    raise exception 'fn_supersede_action_by_cbo: loser et winner identiques (%)', p_loser_id;
  end if;

  select * into v from public.site_actions where id = p_loser_id for update;
  if not found then
    return null;
  end if;

  -- Idempotent : déjà réconciliée (rejouer le pipeline ne doit rien changer).
  if v.status = 'cancelled' or v.superseded_by is not null then
    return v.site_id;
  end if;

  -- Une Action déjà traitée (done) n'est jamais reconciliée automatiquement : la
  -- réapparition documentaire d'une obligation close relève de la doctrine de
  -- divergence documentaire existante (C2A native_completed/reopened), pas de
  -- cette fonction. Hors périmètre volontaire.
  if v.status = 'done' then
    return v.site_id;
  end if;

  if not exists (select 1 from public.site_actions where id = p_winner_id) then
    raise exception 'fn_supersede_action_by_cbo: winner introuvable (%)', p_winner_id;
  end if;

  v_label := (select full_name from public.users where id = p_actor_id);

  update public.site_actions
    set status = 'cancelled', superseded_by = p_winner_id, superseded_at = now()
    where id = p_loser_id;

  insert into public.site_action_events(
    action_id, site_id, kind, actor_id, actor_label, before_value, after_value, reason
  ) values (
    p_loser_id, v.site_id, 'cancelled', p_actor_id, v_label,
    jsonb_build_object('status', v.status),
    jsonb_build_object('motif', 'doublon', 'superseded_by', p_winner_id),
    'Fusion automatique : doublon reconnu via identité CBO (canonical_business_object) inter-preuves/PV.'
  );

  return v.site_id;
end $$;
