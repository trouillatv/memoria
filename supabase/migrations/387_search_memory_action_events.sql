-- Migration 387 — P0-MEM-1 : les GESTES HUMAINS entrent dans la recherche mémoire.
--
-- MemorIA écrivait une excellente mémoire humaine (site_action_events, mig 221 :
-- append-only, daté, attribué, réversible) que search_memory ne lisait PAS.
-- Recette d'audit 2026-09-06 : « Deux RIA manquent toujours dans la réserve 3. »
-- (confirmed_open réel) = 0 hit. Cette migration ferme la rupture
-- ÉCRITURE DURABLE → RECHERCHE MÉMOIRE.
--
-- ⚠️ CE QUI ENTRE, ET RIEN D'AUTRE (classification des kinds) :
--   · completed      → SEARCHABLE (commentaire humain dans after_value->>'comment')
--   · reopened       → SEARCHABLE (motif humain dans reason)
--   · cancelled      → SEARCHABLE (motif structuré + commentaire, mig 385)
--   · confirmed_open → SEARCHABLE (constat humain, mig 386)
--   · created        → EXCLU : 770/795 événements, zéro texte humain (reason
--                      toujours null), et l'action elle-même est DÉJÀ indexée
--                      (action_hits). L'inclure dupliquerait chaque action.
--   · assigned / unassigned / due_date_changed → EXCLUS : pas de texte humain
--                      (labels/dates techniques) ; l'assignation vit déjà dans
--                      l'index de l'action (assigned_to). Révisable si un kind
--                      gagne un commentaire un jour.
--
-- ⚠️ TRACE HISTORIQUE ≠ ÉTAT ACTUEL (doctrine du lot). Un événement est un fait
-- daté qui reste vrai même si l'action a changé d'état depuis (« traité le 10/08 »
-- puis rouverte le 12/08). Le snippet porte donc TOUJOURS « État actuel de
-- l'action : … » depuis site_actions.status — la vérité lifecycle NATIVE, celle
-- que le réducteur C2A consomme ; on ne recalcule AUCUN deuxième lifecycle ici.
-- « de l'action » est délibéré (Vincent 2026-09-06) : aucune confusion possible
-- avec l'état d'un CBO ou d'un sujet canonique.
--
-- ⚠️ COMMENTAIRE SYSTÈME (doctrine mig 386) : quand comment_is_system=true, le
-- texte du constat est un fallback machine (« Constaté toujours ouvert lors de la
-- visite du … »). Il est EXCLU de l'index (chercher « constaté toujours ouvert »
-- ne doit pas ranker du boilerplate) mais reste affiché en snippet : sa formulation
-- se désigne elle-même comme un constat de visite, jamais comme un texte tapé.
--
-- ⚠️ JAMAIS l'acteur dans l'INDEX (doctrine mémoire V5 : la recherche ne traverse
-- pas de données per-personne). L'acteur apparaît dans le snippet (restitution),
-- comme partout ailleurs dans l'app.
--
-- Nouveau type de hit : 'action_event'. `id` = l'événement (unique, stable) ;
-- nouvelle colonne `ref_id` = l'ACTION, pour ouvrir sa fiche (l'événement n'a pas
-- d'adresse propre — sa place est dans l'historique de l'action). `ref_id` est
-- null pour tous les autres corpus : ajout de colonne en FIN de shape,
-- rétrocompatible pour tous les consommateurs existants (champs nommés).
--
-- Additive et idempotente. Rollback : recréer la RPC de la migration 223.

-- Le sous-ensemble cherchable est minuscule (23/795 aujourd'hui) : cet index
-- partiel le matérialise pour que le filtre kind précède le calcul tsvector.
-- Croissance : si le volume l'exige un jour, une colonne tsv générée sur
-- (comment/reason/motif) prendra le relais — décision différée, documentée.
create index if not exists idx_action_events_searchable
  on public.site_action_events (occurred_at)
  where kind in ('completed', 'reopened', 'cancelled', 'confirmed_open');

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
  subject_id uuid,
  ref_id uuid
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
      ts_rank(a.tsv, q.tsq) as rank, a.subject_id, null::uuid as ref_id
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
      ts_rank(sn.tsv, q.tsq) as rank, null::uuid as subject_id, null::uuid as ref_id
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
      ts_rank(i.tsv, q.tsq) as rank, null::uuid as subject_id, null::uuid as ref_id
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
      ts_rank(p.tsv, q.tsq) as rank, null::uuid as subject_id, null::uuid as ref_id
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
      ts_rank(sa.tsv, q.tsq) as rank, sa.subject_id, null::uuid as ref_id
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
      ts_rank(pr.tsv, q.tsq) as rank, pr.subject_id, null::uuid as ref_id
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
      ts_rank(r.tsv, q.tsq) as rank, r.subject_id, null::uuid as ref_id
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
      null::uuid as subject_id, null::uuid as ref_id
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
      ts_rank(vc.tsv, q.tsq) as rank, vc.subject_id, null::uuid as ref_id
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
      ts_rank(d.tsv, q.tsq) as rank, d.subject_id, null::uuid as ref_id
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
      ts_rank(k.tsv, q.tsq) as rank, k.subject_id, null::uuid as ref_id
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
      ts_rank(b.tsv, q.tsq) as rank, b.subject_id, null::uuid as ref_id
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
      ts_rank(o.tsv, q.tsq) as rank, o.subject_id, null::uuid as ref_id
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
      (ts_rank(sub.tsv, q.tsq) + 0.5)::real as rank, sub.id as subject_id, null::uuid as ref_id
    from public.subjects sub
    join public.sites s on s.id = sub.site_id
    cross join query q
    where sub.tsv @@ q.tsq
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sub.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  ),
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
      null::uuid as subject_id, null::uuid as ref_id
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
  ,meeting_hits as (
    select
      'meeting'::text as type, rep.id,
      coalesce(nullif(trim(rep.title), ''),
               case when rep.origin is not null then 'Visite' else 'Réunion' end) as title,
      left(coalesce(rep.text_input, ''), 200) as snippet,
      coalesce(rep.started_at, rep.created_at) as occurred_at,
      rep.site_id, s.contract_id,
      ts_rank(rep.tsv, q.tsq) as rank,
      null::uuid as subject_id, null::uuid as ref_id
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
  ,intervenant_hits as (
    select
      'intervenant'::text as type,
      si.id,
      coalesce(nullif(trim(cc.full_name), ''), co.name) as title,
      trim(both ' · ' from concat_ws(' · ',
        si.role,
        nullif(trim(cc.function), ''),
        case when cc.id is not null then co.name end
      )) as snippet,
      coalesce(si.effective_from::timestamptz, si.created_at) as occurred_at,
      si.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent',
          concat_ws(' ', coalesce(cc.full_name, ''), si.role,
                    coalesce(cc.function, ''), co.name)),
        q.tsq) as rank,
      null::uuid as subject_id, null::uuid as ref_id
    from public.site_intervenants si
    join public.sites s on s.id = si.site_id
    join public.companies co on co.id = si.company_id
    left join public.company_contacts cc
      on cc.id = si.main_contact_id and cc.deleted_at is null
    cross join query q
    where si.effective_to is null
      and to_tsvector('public.french_unaccent',
            concat_ws(' ', coalesce(cc.full_name, ''), si.role,
                      coalesce(cc.function, ''), co.name)) @@ q.tsq
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or si.site_id = p_site_id)
      and (p_org_id is null or s.organization_id = p_org_id)
  )
  -- ── MIG 387 : LES GESTES HUMAINS sur les actions ──────────────────────────
  --
  -- Le texte indexé : titre de l'action + nature du geste (mots français
  -- cherchables) + texte humain (commentaire de clôture depuis
  -- after_value->>'comment' pour completed ; reason pour les autres — SAUF le
  -- fallback système de confirmed_open) + motif d'écartement en clair.
  -- JAMAIS l'acteur (doctrine V5), JAMAIS le JSON brut.
  --
  -- Le snippet dit le fait PUIS l'état actuel : un geste est une trace datée,
  -- pas l'état de l'action aujourd'hui.
  ,action_event_hits as (
    select
      'action_event'::text as type,
      e.id,
      case e.kind
        when 'completed' then 'Clôturée'
        when 'reopened' then 'Rouverte'
        when 'cancelled' then 'Écartée'
        when 'confirmed_open' then 'Vérifiée : toujours ouverte'
      end || ' — ' || sa.title as title,
      trim(both ' · ' from concat_ws(' · ',
        nullif(case when e.kind = 'completed'
                    then coalesce(e.after_value->>'comment', '')
                    else coalesce(e.reason, '') end, ''),
        case e.after_value->>'motif'
          when 'doublon' then 'Motif : doublon'
          when 'non_applicable' then 'Motif : non applicable'
          when 'hors_perimetre' then 'Motif : hors périmètre'
          when 'autre' then 'Motif : autre'
        end,
        'État actuel de l''action : ' || case sa.status
          when 'open' then 'ouverte'
          when 'planned' then 'planifiée'
          when 'done' then 'clôturée'
          when 'cancelled' then 'écartée'
          else sa.status
        end,
        case when nullif(trim(e.actor_label), '') is not null
             then 'par ' || trim(e.actor_label) end
      )) as snippet,
      e.occurred_at,
      sa.site_id,
      s.contract_id,
      ts_rank(
        to_tsvector('public.french_unaccent', concat_ws(' ',
          sa.title,
          case e.kind
            when 'completed' then 'clôturée traitée'
            when 'reopened' then 'rouverte réouverte'
            when 'cancelled' then 'écartée'
            when 'confirmed_open' then 'vérifiée toujours ouverte'
          end,
          case
            when e.kind = 'completed' then coalesce(e.after_value->>'comment', '')
            when e.kind = 'confirmed_open'
                 and coalesce((e.after_value->>'comment_is_system')::boolean, false)
              then ''   -- fallback machine : hors index, jamais rankée comme parole humaine
            else coalesce(e.reason, '')
          end,
          case e.after_value->>'motif'
            when 'doublon' then 'doublon'
            when 'non_applicable' then 'non applicable'
            when 'hors_perimetre' then 'hors périmètre'
            else ''
          end)),
        q.tsq) as rank,
      sa.subject_id,
      sa.id as ref_id
    from public.site_action_events e
    join public.site_actions sa on sa.id = e.action_id
    join public.sites s on s.id = sa.site_id
    cross join query q
    where e.kind in ('completed', 'reopened', 'cancelled', 'confirmed_open')
      and to_tsvector('public.french_unaccent', concat_ws(' ',
            sa.title,
            case e.kind
              when 'completed' then 'clôturée traitée'
              when 'reopened' then 'rouverte réouverte'
              when 'cancelled' then 'écartée'
              when 'confirmed_open' then 'vérifiée toujours ouverte'
            end,
            case
              when e.kind = 'completed' then coalesce(e.after_value->>'comment', '')
              when e.kind = 'confirmed_open'
                   and coalesce((e.after_value->>'comment_is_system')::boolean, false)
                then ''
              else coalesce(e.reason, '')
            end,
            case e.after_value->>'motif'
              when 'doublon' then 'doublon'
              when 'non_applicable' then 'non applicable'
              when 'hors_perimetre' then 'hors périmètre'
              else ''
            end)) @@ q.tsq
      and e.occurred_at > now() - (q.days_window || ' days')::interval
      and (p_contract_id is null or s.contract_id = p_contract_id)
      and (p_site_id is null or sa.site_id = p_site_id)
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
  union all select * from intervenant_hits
  union all select * from action_event_hits
  order by rank desc, occurred_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to authenticated;
grant execute on function public.search_memory(text, uuid, uuid, int, int, uuid) to service_role;
