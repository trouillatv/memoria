-- Migration 122 — S4a-1 : étendre le corpus de search_memory.
--
-- « Interroger ce site » ne voyait que anomalies/notes/interventions/photos.
-- On ajoute la mémoire récente produite par MemorIA, jusqu'ici INVISIBLE :
--   - site_action       : actions validées (titre + corps + responsable)
--   - meeting_decision  : décisions de CR VALIDÉES (proposals status='accepted')
--   - site_reserve      : réserves (libellé + localisation + note de levée)
--   - report_document   : PV VALIDÉS (concat des sections ; JAMAIS le transcript)
--
-- Doctrine : FTS déterministe, zéro LLM. Les nouvelles tables n'ont pas de
-- colonne `tsv` → on calcule to_tsvector à la volée (OK à l'échelle pilote).
-- Filtres org/site/contract/période identiques aux CTE existantes.
-- Signature inchangée (rétrocompatible).

create or replace function public.search_memory(
  p_q text,
  p_contract_id uuid default null,
  p_site_id uuid default null,
  p_period_days int default 365,
  p_limit int default 50,
  p_org_id uuid default null
)
returns table (
  type text,
  id uuid,
  title text,
  snippet text,
  occurred_at timestamptz,
  site_id uuid,
  contract_id uuid,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select plainto_tsquery('public.french_unaccent', p_q) as tsq,
           greatest(p_period_days, 1) as days_window
  ),
  anom_hits as (
    select
      'anomaly'::text as type,
      a.id,
      coalesce(a.description, a.category_other, a.category::text) as title,
      coalesce(a.description, a.resolution_note, '') as snippet,
      a.created_at as occurred_at,
      m.site_id,
      s.contract_id,
      ts_rank(a.tsv, q.tsq) as rank
    from public.intervention_anomalies a
    join public.interventions i on i.id = a.intervention_id
    join public.missions m on m.id = i.mission_id
    join public.sites s on s.id = m.site_id
    cross join query q
    where a.tsv @@ q.tsq
      and a.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or m.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  notes_hits as (
    select
      'site_note'::text as type,
      sn.id,
      left(sn.body, 80) as title,
      sn.body as snippet,
      sn.created_at as occurred_at,
      sn.site_id,
      s.contract_id,
      ts_rank(sn.tsv, q.tsq) as rank
    from public.site_notes sn
    join public.sites s on s.id = sn.site_id
    cross join query q
    where sn.tsv @@ q.tsq
      and sn.deleted_at is null
      and sn.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sn.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  intv_hits as (
    select
      'intervention'::text as type,
      i.id,
      left(coalesce(i.notes, ''), 80) as title,
      coalesce(i.notes, '') as snippet,
      coalesce(i.executed_at, i.scheduled_at) as occurred_at,
      m.site_id,
      s.contract_id,
      ts_rank(i.tsv, q.tsq) as rank
    from public.interventions i
    join public.missions m on m.id = i.mission_id
    join public.sites s on s.id = m.site_id
    cross join query q
    where i.tsv @@ q.tsq
      and coalesce(i.executed_at, i.scheduled_at) > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or m.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  photo_hits as (
    select
      'photo'::text as type,
      p.id,
      coalesce(p.caption, p.kind::text) as title,
      coalesce(p.caption, '') as snippet,
      p.taken_at as occurred_at,
      m.site_id,
      s.contract_id,
      ts_rank(p.tsv, q.tsq) as rank
    from public.intervention_photos p
    join public.interventions i on i.id = p.intervention_id
    join public.missions m on m.id = i.mission_id
    join public.sites s on s.id = m.site_id
    cross join query q
    where p.tsv @@ q.tsq
      and p.taken_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or m.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  -- ── S4a-1 : nouveau corpus (to_tsvector à la volée) ────────────────────────
  action_hits as (
    select
      'site_action'::text as type,
      sa.id,
      sa.title,
      coalesce(sa.body, sa.title) as snippet,
      sa.created_at as occurred_at,
      sa.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          sa.title || ' ' || coalesce(sa.body, '') || ' ' || coalesce(sa.corps_etat, '') || ' ' || coalesce(sa.assigned_to, '')),
        q.tsq) as rank
    from public.site_actions sa
    join public.sites s on s.id = sa.site_id
    cross join query q
    where sa.status <> 'cancelled'
      and to_tsvector('public.french_unaccent',
            sa.title || ' ' || coalesce(sa.body, '') || ' ' || coalesce(sa.corps_etat, '') || ' ' || coalesce(sa.assigned_to, '')) @@ q.tsq
      and sa.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sa.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  -- Décisions de CR VALIDÉES uniquement (status='accepted').
  decision_hits as (
    select
      'meeting_decision'::text as type,
      pr.id,
      pr.short_label as title,
      coalesce(pr.rationale, pr.short_label) as snippet,
      pr.created_at as occurred_at,
      pr.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          pr.short_label || ' ' || coalesce(pr.rationale, '') || ' ' || coalesce(pr.corps_etat, '')),
        q.tsq) as rank
    from public.site_report_proposals pr
    join public.sites s on s.id = pr.site_id
    cross join query q
    where pr.status = 'accepted'
      and to_tsvector('public.french_unaccent',
            pr.short_label || ' ' || coalesce(pr.rationale, '') || ' ' || coalesce(pr.corps_etat, '')) @@ q.tsq
      and pr.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or pr.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  reserve_hits as (
    select
      'site_reserve'::text as type,
      r.id,
      r.label as title,
      coalesce(nullif(r.location, ''), r.label) as snippet,
      coalesce(r.issued_on::timestamptz, r.created_at) as occurred_at,
      r.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          r.label || ' ' || coalesce(r.location, '') || ' ' || coalesce(r.lift_note, '')),
        q.tsq) as rank
    from public.site_reserve r
    join public.sites s on s.id = r.site_id
    cross join query q
    where to_tsvector('public.french_unaccent',
            r.label || ' ' || coalesce(r.location, '') || ' ' || coalesce(r.lift_note, '')) @@ q.tsq
      and coalesce(r.issued_on::timestamptz, r.created_at) > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or r.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  -- PV VALIDÉS : concat des contenus de sections. JAMAIS le transcript brut.
  pv_hits as (
    select
      'report_document'::text as type,
      rd.id,
      coalesce(rep.title, 'Compte-rendu de chantier') as title,
      left(coalesce((select string_agg(sec->>'content', ' ')
                     from jsonb_array_elements(rd.sections) sec), ''), 200) as snippet,
      rd.created_at as occurred_at,
      rd.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          coalesce((select string_agg(sec->>'content', ' ')
                    from jsonb_array_elements(rd.sections) sec), '')),
        q.tsq) as rank
    from public.report_documents rd
    join public.sites s on s.id = rd.site_id
    left join public.site_reports rep on rep.id = rd.report_id
    cross join query q
    where rd.status in ('validated', 'exported')
      and to_tsvector('public.french_unaccent',
            coalesce((select string_agg(sec->>'content', ' ')
                      from jsonb_array_elements(rd.sections) sec), '')) @@ q.tsq
      and rd.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or rd.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  )
  select * from anom_hits
  union all select * from notes_hits
  union all select * from intv_hits
  union all select * from photo_hits
  union all select * from action_hits
  union all select * from decision_hits
  union all select * from reserve_hits
  union all select * from pv_hits
  order by rank desc, occurred_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to authenticated;
grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to service_role;
