-- Migration 222 — La RÉUNION devient trouvable. Lot 4, premier objet.
--
-- Le corpus de recherche connaissait les DÉCISIONS d'une réunion et son
-- compte-rendu validé, mais pas la réunion. On pouvait donc trouver ses effets
-- sans jamais pouvoir ouvrir leur cause — alors que la réunion est la TÊTE de la
-- chaîne causale du chantier.
--
-- Deux règles acquises au Lot 3 s'appliquent ici sans être rediscutées :
--
--   1. « Une recherche utilisateur déclenche une SEULE opération de retrieval,
--      quel que soit le nombre de types affichés. » — d'où un corpus de plus
--      DANS la même RPC, jamais une seconde requête à côté.
--
--   2. « La recherche ouvre l'objet qui satisfait la requête, pas le conteneur
--      qui le référence. » — un résultat de type `meeting` ouvre la fiche
--      Réunion (/sites/<id>/reunion/<id>), jamais le chantier.
--
-- Ce qui entre dans l'index, et ce qui n'y entre pas :
--   · OUI  le titre de la réunion et les notes SAISIES (`text_input`) ;
--   · NON  la transcription audio (parole brute, non validée) ;
--   · NON  les brouillons (`status = 'draft'`) : une capture en cours n'est pas
--          encore un fait.
--
-- Additive et idempotente. Rollback : DROP INDEX + DROP COLUMN + recréer la RPC
-- de la migration 204.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La colonne tsv de la réunion — titre + notes saisies, jamais le transcript.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.site_reports
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(title, '') || ' ' || coalesce(text_input, ''))
  ) stored;

comment on column public.site_reports.tsv is
  'Index de recherche de la réunion : titre + notes saisies. Le transcript en est EXCLU — parole brute non validée, jamais mélangée aux faits de chantier.';

create index if not exists site_reports_tsv_idx
  on public.site_reports using gin (tsv)
  where status <> 'draft';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La RPC — mêmes paramètres, même type de retour. Un corpus de plus.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.search_memory(text, uuid, uuid, int, int, uuid);

create function public.search_memory(
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
  rank real,
  subject_id uuid
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
      'anomaly'::text as type, a.id,
      coalesce(a.description, a.category_other, a.category::text) as title,
      coalesce(a.description, a.resolution_note, '') as snippet,
      a.created_at as occurred_at, m.site_id, s.contract_id,
      ts_rank(a.tsv, q.tsq) as rank, a.subject_id
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
      'site_note'::text as type, sn.id,
      left(sn.body, 80) as title, sn.body as snippet,
      sn.created_at as occurred_at, sn.site_id, s.contract_id,
      ts_rank(sn.tsv, q.tsq) as rank, null::uuid as subject_id
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
      'intervention'::text as type, i.id,
      left(coalesce(i.notes, ''), 80) as title, coalesce(i.notes, '') as snippet,
      coalesce(i.executed_at, i.scheduled_at) as occurred_at, m.site_id, s.contract_id,
      ts_rank(i.tsv, q.tsq) as rank, null::uuid as subject_id
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
      'photo'::text as type, p.id,
      coalesce(p.caption, p.kind::text) as title, coalesce(p.caption, '') as snippet,
      p.taken_at as occurred_at, m.site_id, s.contract_id,
      ts_rank(p.tsv, q.tsq) as rank, null::uuid as subject_id
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
  action_hits as (
    select
      'site_action'::text as type, sa.id,
      sa.title, coalesce(sa.body, sa.title) as snippet,
      sa.created_at as occurred_at, sa.site_id, s.contract_id,
      ts_rank(sa.tsv, q.tsq) as rank, sa.subject_id
    from public.site_actions sa
    join public.sites s on s.id = sa.site_id
    cross join query q
    where sa.tsv @@ q.tsq
      and sa.status <> 'cancelled'
      and sa.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sa.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  decision_hits as (
    select
      'meeting_decision'::text as type, pr.id,
      pr.short_label as title, coalesce(pr.rationale, pr.short_label) as snippet,
      pr.created_at as occurred_at, pr.site_id, s.contract_id,
      ts_rank(pr.tsv, q.tsq) as rank, pr.subject_id
    from public.site_report_proposals pr
    join public.sites s on s.id = pr.site_id
    cross join query q
    where pr.tsv @@ q.tsq
      and pr.status = 'accepted'
      and pr.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or pr.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  reserve_hits as (
    select
      'site_reserve'::text as type, r.id,
      r.label as title, coalesce(nullif(r.location, ''), r.label) as snippet,
      coalesce(r.issued_on::timestamptz, r.created_at) as occurred_at, r.site_id, s.contract_id,
      ts_rank(r.tsv, q.tsq) as rank, r.subject_id
    from public.site_reserve r
    join public.sites s on s.id = r.site_id
    cross join query q
    where r.tsv @@ q.tsq
      and coalesce(r.issued_on::timestamptz, r.created_at) > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or r.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  pv_hits as (
    select
      'report_document'::text as type, rd.id,
      coalesce(rep.title, 'Compte-rendu de chantier') as title,
      left(coalesce((select string_agg(sec->>'content', ' ')
                     from jsonb_array_elements(rd.sections) sec), ''), 200) as snippet,
      rd.created_at as occurred_at, rd.site_id, s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          coalesce((select string_agg(sec->>'content', ' ')
                    from jsonb_array_elements(rd.sections) sec), '')),
        q.tsq) as rank,
      null::uuid as subject_id
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
  ),
  observation_hits as (
    select
      'observation'::text as type, vc.id,
      left(vc.body, 80) as title, vc.body as snippet,
      coalesce(vc.captured_at, vc.created_at) as occurred_at, vc.site_id, s.contract_id,
      ts_rank(vc.tsv, q.tsq) as rank, vc.subject_id
    from public.visit_capture vc
    join public.sites s on s.id = vc.site_id
    cross join query q
    where vc.tsv @@ q.tsq
      and vc.status <> 'discarded'
      and coalesce(vc.captured_at, vc.created_at) > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or vc.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  site_decision_hits as (
    select
      'site_decision'::text as type, d.id,
      d.titre as title, coalesce(d.description, d.sujet, d.titre) as snippet,
      d.date_decision::timestamptz as occurred_at, d.site_id, s.contract_id,
      ts_rank(d.tsv, q.tsq) as rank, d.subject_id
    from public.site_decisions d
    join public.sites s on s.id = d.site_id
    cross join query q
    where d.tsv @@ q.tsq
      and d.date_decision::timestamptz > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or d.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  knowledge_hits as (
    select
      'knowledge'::text as type, k.id,
      k.title, coalesce(k.body, k.title) as snippet,
      k.created_at as occurred_at, k.site_id, s.contract_id,
      ts_rank(k.tsv, q.tsq) as rank, k.subject_id
    from public.captured_knowledge k
    join public.sites s on s.id = k.site_id
    cross join query q
    where k.tsv @@ q.tsq
      and k.status <> 'dismissed'
      and k.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or k.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  blocage_hits as (
    select
      'blocage'::text as type, b.id,
      b.title, coalesce(b.description, b.impact, b.title) as snippet,
      b.date_start::timestamptz as occurred_at, b.site_id, s.contract_id,
      ts_rank(b.tsv, q.tsq) as rank, b.subject_id
    from public.site_blocages b
    join public.sites s on s.id = b.site_id
    cross join query q
    where b.tsv @@ q.tsq
      and b.date_start::timestamptz > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or b.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  obligation_hits as (
    select
      'obligation'::text as type, o.id,
      o.label as title, coalesce(o.satisfied_note, o.label) as snippet,
      o.created_at as occurred_at, o.site_id, s.contract_id,
      ts_rank(o.tsv, q.tsq) as rank, o.subject_id
    from public.site_obligation o
    join public.sites s on s.id = o.site_id
    cross join query q
    where o.tsv @@ q.tsq
      and o.status <> 'non_applicable'
      and o.created_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or o.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
  subject_hits as (
    select
      'subject'::text as type, sub.id,
      sub.name as title, sub.name as snippet,
      coalesce(sub.updated_at, sub.created_at) as occurred_at, sub.site_id, s.contract_id,
      (ts_rank(sub.tsv, q.tsq) + 0.5)::real as rank, sub.id as subject_id
    from public.subjects sub
    join public.sites s on s.id = sub.site_id
    cross join query q
    where sub.tsv @@ q.tsq
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sub.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),

  -- ── MIG 204 : LES DOCUMENTS, SAUF LES LITIGES ────────────────────────────
  --
  -- Le filtre `document_type <> 'litige'` est ici, DANS LA SOURCE — et l'index
  -- partiel ci-dessus l'applique une seconde fois, structurellement. Un document
  -- reclassé en litige sort du corpus à la requête suivante : rien à désindexer,
  -- donc rien qui puisse être oublié.
  --
  -- L'extrait vient de `ts_headline` : la phrase AUTOUR du mot cherché.
  document_hits as (
    select distinct on (doc.id, dl.target_id)
      'document'::text as type, doc.id,
      doc.filename as title,
      ts_headline('public.french_unaccent', coalesce(doc.extracted_text, ''), q.tsq,
        'StartSel=<<, StopSel=>>, MaxWords=28, MinWords=8, MaxFragments=1, FragmentDelimiter= … ')
        as snippet,
      coalesce(doc.effective_date::timestamptz, doc.created_at) as occurred_at,
      dl.target_id as site_id,
      s.contract_id,
      ts_rank(doc.tsv, q.tsq) as rank,
      null::uuid as subject_id
    from public.documents doc
    join public.document_links dl
      on dl.document_id = doc.id and dl.target_type = 'site'
    join public.sites s on s.id = dl.target_id
    cross join query q
    where doc.tsv @@ q.tsq
      and doc.document_type <> 'litige'   -- ⚖️ LA RÈGLE. Ne jamais la retirer.
      and doc.deleted_at is null
      and doc.extracted_text is not null
      and coalesce(doc.effective_date::timestamptz, doc.created_at)
            > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or dl.target_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  )
  -- LA RÉUNION elle-même — l'objet, pas seulement ce qu'elle a produit.
  --
  -- Jusqu'ici le corpus contenait les décisions d'une réunion et son compte-rendu
  -- validé, mais jamais la réunion : on trouvait ses effets sans pouvoir ouvrir
  -- leur cause. C'est exactement le défaut que le Lot 4 vient corriger objet par
  -- objet.
  --
  -- ⚠️ Le TRANSCRIPT est volontairement HORS corpus, et ce n'est pas un oubli.
  -- Une transcription est de la parole brute, non validée : la remonter dans des
  -- résultats de recherche mélangerait un propos de couloir et un fait de
  -- chantier, et la phrase serait ensuite citée comme établie. Même motif que
  -- « JAMAIS le transcript brut » dans pv_hits. On indexe le titre et les notes
  -- SAISIES (`text_input`), écrites par un humain. Le compte-rendu validé a déjà
  -- son corpus.
  --
  -- Les brouillons n'entrent pas : une capture en cours n'est pas encore un fait.
  ,meeting_hits as (
    select
      'meeting'::text as type, rep.id,
      coalesce(nullif(trim(rep.title), ''),
               case when rep.origin is not null then 'Visite' else 'Réunion' end) as title,
      left(coalesce(rep.text_input, ''), 200) as snippet,
      coalesce(rep.started_at, rep.created_at) as occurred_at,
      rep.site_id, s.contract_id,
      ts_rank(rep.tsv, q.tsq) as rank,
      null::uuid as subject_id
    from public.site_reports rep
    join public.sites s on s.id = rep.site_id
    cross join query q
    where rep.tsv @@ q.tsq
      and rep.status <> 'draft'
      and coalesce(rep.started_at, rep.created_at) > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or rep.site_id = p_site_id)
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
  union all select * from observation_hits
  union all select * from site_decision_hits
  union all select * from knowledge_hits
  union all select * from blocage_hits
  union all select * from obligation_hits
  union all select * from subject_hits
  union all select * from document_hits
  union all select * from meeting_hits
  order by rank desc, occurred_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to authenticated;
grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to service_role;
