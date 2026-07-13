-- Migration 200 — La recherche voit enfin TOUTE la mémoire.
--
-- Le constat qui a déclenché ce lot : `search_memory` ne voyait pas
-- `visit_capture.body`. C'est-à-dire qu'il ne voyait AUCUNE observation de
-- terrain — ni les notes prises sur place, ni les transcriptions des vocaux.
-- Le cœur du produit était invisible à sa propre recherche.
--
-- Étaient absents aussi : les décisions de chantier, la connaissance captée,
-- les blocages, les obligations, et les SUJETS eux-mêmes.
--
-- Ce que fait cette migration :
--
--   1. INDEXE. Les CTE ajoutées en mig 122 (actions, réserves, PV, décisions de
--      CR) recalculaient `to_tsvector` à CHAQUE requête, sur toute la table.
--      Elles ont maintenant des colonnes `tsv` générées + index GIN, comme les
--      corpus historiques (mig 043).
--
--   2. ÉLARGIT. Six sources entrent dans le corpus :
--        observation        — visit_capture.body (LE trou)
--        site_decision      — site_decisions (titre + description + sujet)
--        knowledge          — captured_knowledge
--        blocage            — site_blocages
--        obligation         — site_obligation
--        subject            — le nom du sujet lui-même
--
--   3. REMONTE LE SUJET. Chaque résultat porte désormais `subject_id` quand
--      l'objet est rattaché à un sujet. C'est ce qui permet de répondre à
--      « on avait déjà vu cette fuite ? » par une HISTOIRE et non par une liste.
--
-- Doctrine : FTS déterministe, zéro LLM. Ce moteur CLASSE des faits datés et
-- sourcés ; il ne rédige rien.
--
-- Hors corpus, volontairement :
--   • `site_reports.transcript_*` — le transcript brut n'est jamais indexé
--     (déjà la règle en mig 122) ;
--   • les DOCUMENTS — ils restent joignables par similarité sémantique. Les
--     faire entrer ici demanderait de trancher le cas `document_type='litige'`
--     (jamais de lecture automatique), qui est une décision produit.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Les colonnes tsv manquantes + leurs index.
--    `to_tsvector(regconfig, text)` est IMMUTABLE → utilisable en colonne générée.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.site_actions
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(title, '') || ' ' || coalesce(body, '') || ' ' ||
      coalesce(corps_etat, '') || ' ' || coalesce(assigned_to, ''))
  ) stored;
create index if not exists site_actions_tsv_idx on public.site_actions using gin (tsv);

alter table public.site_reserve
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(label, '') || ' ' || coalesce(location, '') || ' ' || coalesce(lift_note, ''))
  ) stored;
create index if not exists site_reserve_tsv_idx on public.site_reserve using gin (tsv);

alter table public.site_report_proposals
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(short_label, '') || ' ' || coalesce(rationale, '') || ' ' || coalesce(corps_etat, ''))
  ) stored;
create index if not exists site_report_proposals_tsv_idx on public.site_report_proposals using gin (tsv);

-- LE TROU : l'observation de terrain. Note saisie sur place OU transcription
-- d'un vocal — c'est la matière première du produit.
alter table public.visit_capture
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent', coalesce(body, ''))
  ) stored;
create index if not exists visit_capture_tsv_idx on public.visit_capture using gin (tsv);

alter table public.site_decisions
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(titre, '') || ' ' || coalesce(description, '') || ' ' || coalesce(sujet, ''))
  ) stored;
create index if not exists site_decisions_tsv_idx on public.site_decisions using gin (tsv);

alter table public.captured_knowledge
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;
create index if not exists captured_knowledge_tsv_idx on public.captured_knowledge using gin (tsv);

alter table public.site_blocages
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(impact, ''))
  ) stored;
create index if not exists site_blocages_tsv_idx on public.site_blocages using gin (tsv);

alter table public.site_obligation
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent', coalesce(label, ''))
  ) stored;
create index if not exists site_obligation_tsv_idx on public.site_obligation using gin (tsv);

alter table public.subjects
  add column if not exists tsv tsvector generated always as (
    to_tsvector('public.french_unaccent', coalesce(name, ''))
  ) stored;
create index if not exists subjects_tsv_idx on public.subjects using gin (tsv);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La RPC. Mêmes paramètres (rétrocompatible) ; une colonne de plus en
--    sortie : `subject_id`. Le changement du type de retour impose le DROP.
-- ─────────────────────────────────────────────────────────────────────────────

-- ⚠️ Une surcharge à 5 arguments traîne depuis la mig 044 (avant le filtre org).
-- Tant qu'elle existe, PostgREST refuse de choisir dès qu'on omet p_org_id
-- (« could not choose the best candidate function ») : un appel légitime échoue
-- pour une raison invisible. On la retire.
drop function if exists public.search_memory(text, uuid, uuid, int, int);
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
  -- Le fil auquel ce fait est rattaché, s'il l'est. C'est lui qui transforme
  -- une liste de résultats en histoire.
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
  -- Décisions de CR VALIDÉES uniquement (status='accepted').
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
  -- PV VALIDÉS : concat des sections. JAMAIS le transcript brut.
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

  -- ── NOUVEAU CORPUS ────────────────────────────────────────────────────────

  -- L'OBSERVATION DE TERRAIN. Ce qui a été vu, dit, dicté sur place. Le corpus
  -- le plus vivant du produit — et le grand absent jusqu'ici.
  -- Les captures ÉCARTÉES au tri (status='discarded') restent hors recherche :
  -- l'humain a dit « ça ne compte pas ». On ne le contredit pas.
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
  -- Les décisions de chantier (l'objet durable, pas la proposition de CR).
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
  -- La connaissance captée (promesse, risque, contexte…). Écartée = hors corpus.
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
  -- L'obligation est PRESCRIPTIVE : la retrouver, c'est retrouver ce qui DEVAIT
  -- être fait. Les obligations écartées (non_applicable) sortent du corpus.
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
  -- LE SUJET lui-même. « chambres froides » ne renvoie plus seulement des faits
  -- épars : il renvoie LE FIL, dont on peut dérouler toute l'histoire.
  -- Les sujets clos restent trouvables : « on avait déjà vu ça ? » interroge
  -- justement ce qui est terminé.
  subject_hits as (
    select
      'subject'::text as type, sub.id,
      sub.name as title, sub.name as snippet,
      coalesce(sub.updated_at, sub.created_at) as occurred_at, sub.site_id, s.contract_id,
      -- Un sujet qui porte le mot cherché EST la meilleure réponse possible :
      -- on le remonte au-dessus des faits isolés.
      (ts_rank(sub.tsv, q.tsq) + 0.5)::real as rank, sub.id as subject_id
    from public.subjects sub
    join public.sites s on s.id = sub.site_id
    cross join query q
    where sub.tsv @@ q.tsq
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sub.site_id = p_site_id)
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
  order by rank desc, occurred_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to authenticated;
grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to service_role;
