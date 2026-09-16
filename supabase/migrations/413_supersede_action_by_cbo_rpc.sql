-- 413 — Réconciliation post-CBO des Actions longitudinales (P0-B, arbitrage Vincent 2026-09-17 ;
-- durci P0-B.1, arbitrage Vincent 2026-09-17 sur les 7 points de la revue).
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
-- P0-B.1 distingue explicitement deux questions (arbitrage Vincent) :
--   1. CBO = identité : « ces deux lignes parlent-elles de la même obligation ? »
--   2. Réconciliation = état opérationnel : « quelle est la meilleure représentation
--      courante de cette obligation ? » — jamais un tri « le plus ancien gagne » qui
--      écraserait silencieusement une donnée plus riche ou plus récente.
--
-- Doctrine de fusion (arbitrage Vincent) :
--   · Identité durable = la ligne la plus ancienne (« durable »), tie-break par id —
--     jamais changée, pour ne jamais casser un lien externe vers cet id.
--   · Le champ statut ne progresse JAMAIS qu'en avant sur l'échelle planned < open <
--     done (jamais de recul). Une Action déjà DONE n'est JAMAIS réouverte par ce
--     module — jamais de réouverture automatique par la réconciliation CBO, quelle
--     que soit la provenance de la clôture. La réouverture reste un geste métier
--     dédié (fn_reopen_action), jamais une conséquence de la résolution d'identité.
--   · Les champs simples (titre, corps, entreprise assignée, réserve liée) ne sont
--     comblés que s'ils sont vides côté durable — jamais écrasés s'ils portent déjà
--     une valeur.
--   · Contact assigné et échéance sont protégés plus fort : si un humain les a
--     explicitement retirés (événement `unassigned` / `due_date_changed` vers null
--     au journal), un doublon ne peut jamais les re-remplir silencieusement.
--   · « Une donnée humaine explicite ne doit jamais être écrasée silencieusement par
--     une valeur issue d'un import. »
--
-- Provenance : jamais de DELETE, jamais de perte de la trace de l'occurrence source
-- (report_id, canonical_business_object_member, document_proposal_materialization
-- inchangés sur la ligne perdante). object_state_occurrence_signal (mig 349) est
-- scopé au CBO, pas au statut de l'Action membre : la trajectoire « vue dans N PV »
-- survit intacte à la fusion (vérifié directement dans loadCboEvolutions).
--
-- Réversible : fn_reopen_action accepte déjà status='cancelled' — une réconciliation
-- erronée se répare par une réouverture humaine normale (avant_value au journal
-- conserve superseded_by pour audit, la colonne superseded_by elle-même n'est PAS
-- remise à null par une réouverture : elle documente l'historique, pas l'état courant).
--
-- Concurrence : le groupe entier (durable + perdants) est verrouillé EN UNE SEULE
-- instruction, triée par id croissant, avant toute lecture/écriture — deux appels
-- concurrents sur le même groupe (même avec des rôles durable/perdant physiquement
-- inversés d'un appelant à l'autre) se sérialisent sur le même ordre de verrou :
-- jamais de deadlock croisé, jamais de double-fusion mutuelle.
--
-- Additif : une seule fonction remplacée (aucune colonne/contrainte retirée), le
-- CHECK de site_action_events est élargi (jamais réduit) pour accepter `merged`.
--
-- Durcissement pipeline (point 6, arbitrage Vincent 2026-09-17) : cette étape
-- protège désormais un invariant fonctionnel (pas de doublon d'obligation
-- active), elle n'est donc plus un simple best-effort qui avale son erreur.
-- action_cbo_reconcile_error mirroir exactement le patron déjà en place pour
-- canonical_reconcile_error (mig 318) : NULL = dernier passage réussi (ou
-- jamais tenté), texte = raison de l'échec, rejouable sans étape dédiée
-- puisque le pipeline recalcule et retente cette étape à chaque relance.

-- 1. Le journal accepte désormais aussi le kind `merged` (absorption de champs sur
--    la ligne durable, distinct de `cancelled` qui documente la ligne perdante).
ALTER TABLE public.site_action_events DROP CONSTRAINT IF EXISTS site_action_events_kind_check;
ALTER TABLE public.site_action_events ADD CONSTRAINT site_action_events_kind_check
  CHECK (kind in ('created','assigned','unassigned','due_date_changed','completed','reopened','cancelled','merged'));

-- 1bis. Observabilité/retry de la réconciliation CBO des Actions (point 6).
ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS action_cbo_reconcile_error text;

COMMENT ON COLUMN public.site_reports.action_cbo_reconcile_error IS
  'Erreur de la dernière réconciliation CBO des Actions (fn_apply_action_cbo_merge) pour ce rapport. '
  'NULL = dernier passage réussi ou jamais tenté. Ne bloque jamais un nouvel essai (pas un lock).';

-- 2. L'ancienne fonction pair-à-pair est remplacée par une fonction de groupe
--    atomique — jamais deux RPC concurrentes à maintenir pour la même doctrine.
drop function if exists public.fn_supersede_action_by_cbo(uuid, uuid, uuid);

create or replace function public.fn_apply_action_cbo_merge(
  p_durable_id uuid,
  p_loser_ids uuid[],
  p_patch jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns integer language plpgsql set search_path = '' as $$
declare
  v_durable public.site_actions;
  v_loser public.site_actions;
  v_label text;
  v_loser_id uuid;
  v_superseded_count integer := 0;
  v_before jsonb;
begin
  if p_durable_id = any(p_loser_ids) then
    raise exception 'fn_apply_action_cbo_merge: durable figure dans p_loser_ids (%)', p_durable_id;
  end if;

  -- Verrou de groupe déterministe (voir doctrine ci-dessus) : AVANT toute lecture.
  perform 1 from public.site_actions
    where id = p_durable_id or id = any(p_loser_ids)
    order by id
    for update;

  select * into v_durable from public.site_actions where id = p_durable_id;
  if not found then
    return 0;
  end if;

  -- Idempotent ET protection cas C : une Action déjà 'done' n'est jamais fusionnée
  -- (ni ses champs modifiés, ni un perdant superseded en son nom) — jamais de
  -- réouverture automatique par ce module, quelle que soit l'origine de la clôture.
  if v_durable.status = 'done' then
    return 0;
  end if;

  v_label := (select full_name from public.users where id = p_actor_id);
  v_before := to_jsonb(v_durable);

  update public.site_actions set
    title                = case when p_patch ? 'title'               then (p_patch->>'title')                     else title end,
    body                 = case when p_patch ? 'body'                then (p_patch->>'body')                      else body end,
    assigned_to          = case when p_patch ? 'assignedTo'          then (p_patch->>'assignedTo')                else assigned_to end,
    assigned_contact_id  = case when p_patch ? 'assignedContactId'   then (p_patch->>'assignedContactId')::uuid   else assigned_contact_id end,
    assigned_company_id  = case when p_patch ? 'assignedCompanyId'   then (p_patch->>'assignedCompanyId')::uuid   else assigned_company_id end,
    due_date             = case when p_patch ? 'dueDate'             then (p_patch->>'dueDate')::date             else due_date end,
    due_date_status      = case when p_patch ? 'dueDateStatus'       then (p_patch->>'dueDateStatus')             else due_date_status end,
    reserve_id           = case when p_patch ? 'reserveId'           then (p_patch->>'reserveId')::uuid           else reserve_id end,
    status               = case when p_patch ? 'status'              then (p_patch->>'status')                    else status end,
    done_at              = case when p_patch ? 'doneAt'              then (p_patch->>'doneAt')::timestamptz       else done_at end,
    completed_comment    = case when p_patch ? 'completedComment'    then (p_patch->>'completedComment')          else completed_comment end,
    completed_photo_path = case when p_patch ? 'completedPhotoPath'  then (p_patch->>'completedPhotoPath')        else completed_photo_path end
  where id = p_durable_id;

  if p_patch <> '{}'::jsonb then
    insert into public.site_action_events(
      action_id, site_id, kind, actor_id, actor_label, before_value, after_value, reason
    ) values (
      p_durable_id, v_durable.site_id, 'merged', p_actor_id, v_label,
      v_before, p_patch,
      'Fusion automatique : absorption de champs/état depuis les doublons CBO ' || array_to_string(p_loser_ids, ',')
    );
  end if;

  foreach v_loser_id in array p_loser_ids loop
    select * into v_loser from public.site_actions where id = v_loser_id;
    if not found then continue; end if;
    -- Idempotent : déjà réconciliée (rejouer le pipeline, ou appel concurrent
    -- déjà passé pendant l'attente du verrou de groupe, ne change plus rien).
    if v_loser.status = 'cancelled' or v_loser.superseded_by is not null then continue; end if;

    update public.site_actions
      set status = 'cancelled', superseded_by = p_durable_id, superseded_at = now()
      where id = v_loser_id;

    insert into public.site_action_events(
      action_id, site_id, kind, actor_id, actor_label, before_value, after_value, reason
    ) values (
      v_loser_id, v_loser.site_id, 'cancelled', p_actor_id, v_label,
      jsonb_build_object('status', v_loser.status),
      jsonb_build_object('motif', 'doublon', 'superseded_by', p_durable_id),
      'Fusion automatique : doublon reconnu via identité CBO (canonical_business_object) inter-preuves/PV.'
    );
    v_superseded_count := v_superseded_count + 1;
  end loop;

  return v_superseded_count;
end $$;
