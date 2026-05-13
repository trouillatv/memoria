-- Migration 039 — RPC contract_summaries (perf dashboard).
--
-- Remplace la boucle Promise.all(contracts.map(summarizeContract)) du
-- dashboard manager qui faisait ~4 queries × N contrats = jusqu'à 120
-- requêtes parallèles.
--
-- Calcule en SQL pour chaque contrat passé :
--   - engagementsTotal (nb engagements actifs)
--   - planned (ratio engagements avec au moins une mission)
--   - executed (moyenne du ratio executed/total interventions par engagement)
--   - proven (moyenne du ratio avec photos / executed)
--   - validated (moyenne du ratio validated / executed)
--   - needsAttention (true si min < 0.7 et au moins un engagement planifié)
--
-- Cohérent avec la logique JS originale d'app/(dashboard)/dashboard/page.tsx.

create or replace function public.contract_summaries(p_contract_ids uuid[])
returns table (
  contract_id uuid,
  engagements_total int,
  planned numeric,
  executed numeric,
  proven numeric,
  validated numeric,
  needs_attention boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with eng as (
    select id as engagement_id, contract_id
    from public.engagements
    where contract_id = any(p_contract_ids) and status = 'active'
  ),
  per_engagement as (
    select
      e.contract_id,
      e.engagement_id,
      exists (
        select 1 from public.missions m
        where m.deleted_at is null and e.engagement_id = any(m.engagement_ids)
      ) as is_planned,
      coalesce((
        select count(*)::int from public.interventions i
        join public.missions m on m.id = i.mission_id
        where m.deleted_at is null and e.engagement_id = any(m.engagement_ids)
      ), 0) as total_interv,
      coalesce((
        select count(*)::int from public.interventions i
        join public.missions m on m.id = i.mission_id
        where m.deleted_at is null and e.engagement_id = any(m.engagement_ids)
          and i.status in ('completed', 'validated')
      ), 0) as executed_interv,
      coalesce((
        select count(distinct i.id)::int from public.interventions i
        join public.missions m on m.id = i.mission_id
        join public.intervention_photos p on p.intervention_id = i.id
        where m.deleted_at is null and e.engagement_id = any(m.engagement_ids)
          and i.status in ('completed', 'validated')
      ), 0) as proven_interv,
      coalesce((
        select count(*)::int from public.interventions i
        join public.missions m on m.id = i.mission_id
        where m.deleted_at is null and e.engagement_id = any(m.engagement_ids)
          and i.status = 'validated'
      ), 0) as validated_interv
    from eng e
  ),
  ratios as (
    select
      contract_id,
      engagement_id,
      case when is_planned then 1.0 else 0.0 end::numeric as planned_ratio,
      case when total_interv > 0
        then executed_interv::numeric / total_interv
        else 0::numeric
      end as executed_ratio,
      case when executed_interv > 0
        then proven_interv::numeric / executed_interv
        else 0::numeric
      end as proven_ratio,
      case when executed_interv > 0
        then validated_interv::numeric / executed_interv
        else 0::numeric
      end as validated_ratio
    from per_engagement
  ),
  aggregated as (
    select
      r.contract_id,
      count(*)::int as engagements_total,
      avg(r.planned_ratio) as planned,
      avg(r.executed_ratio) as executed,
      avg(r.proven_ratio) as proven,
      avg(r.validated_ratio) as validated
    from ratios r
    group by r.contract_id
  )
  select
    a.contract_id,
    a.engagements_total,
    a.planned,
    a.executed,
    a.proven,
    a.validated,
    (least(a.planned, a.executed, a.proven, a.validated) < 0.7 and a.planned > 0)::boolean
      as needs_attention
  from aggregated a;
$$;

grant execute on function public.contract_summaries(uuid[]) to authenticated;
grant execute on function public.contract_summaries(uuid[]) to service_role;
