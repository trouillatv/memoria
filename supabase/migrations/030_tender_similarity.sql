-- Migration 030 : Tender similarity infrastructure (MC-2)
--
-- Goal : matching trigram entre AO courant (title + client_name) et AO passés
-- ayant un outcome IN (won, lost). Sert la "Mémoire des AO similaires"
-- affichée au démarrage d'un nouvel AO.
--
-- Doctrine V5 verrou V1 : mémoire ≠ recommandation. La fonction retourne
-- des FAITS (AO comparables passés), aucun score commercial, aucune
-- prescription. L'UI rend le contenu en formulation passive descriptive.
--
-- Approche : pg_trgm déjà installée (migration 020). Greatest(similarity)
-- entre title et client_name. GIN indexes sur tenders.title et
-- tenders.client_name pour perf.

-- ==========================================
-- GIN indexes for fast similarity search on tenders
-- ==========================================
create index if not exists tenders_title_trgm_idx
  on public.tenders
  using gin (title extensions.gin_trgm_ops)
  where deleted_at is null;

create index if not exists tenders_client_name_trgm_idx
  on public.tenders
  using gin (client_name extensions.gin_trgm_ops)
  where deleted_at is null and client_name is not null;

-- ==========================================
-- RPC function : find_similar_tender_memory
-- ==========================================
-- Retourne les AO passés avec outcome IN ('won','lost') qui matchent
-- le title ou client_name fournis (similarity >= threshold).
--
-- Tri : outcome='lost' first (urgence mnemonique), puis outcome_at DESC.
-- Limit configurable (default 5).
--
-- Note search_path : pg_trgm vit dans `extensions` (cf. migration 020).
create or replace function public.find_similar_tender_memory(
  p_current_tender_id uuid,
  p_title text,
  p_client_name text,
  p_threshold float default 0.25,
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  client_name text,
  outcome public.tender_outcome,
  outcome_at timestamptz,
  outcome_reason text,
  outcome_tag public.tender_outcome_tag,
  similarity float
)
language sql
security definer
set search_path = ''
as $$
  select
    t.id,
    t.title,
    t.client_name,
    t.outcome,
    t.outcome_at,
    t.outcome_reason,
    t.outcome_tag,
    greatest(
      extensions.similarity(coalesce(t.title, ''), coalesce(p_title, '')),
      extensions.similarity(coalesce(t.client_name, ''), coalesce(p_client_name, ''))
    ) as similarity
  from public.tenders t
  where t.id <> p_current_tender_id
    and t.deleted_at is null
    and t.outcome in ('won', 'lost')
    and (
      extensions.similarity(coalesce(t.title, ''), coalesce(p_title, '')) >= p_threshold
      or extensions.similarity(coalesce(t.client_name, ''), coalesce(p_client_name, '')) >= p_threshold
    )
  order by
    case when t.outcome = 'lost' then 0 else 1 end,
    t.outcome_at desc nulls last
  limit p_limit;
$$;

grant execute on function public.find_similar_tender_memory(uuid, text, text, float, int) to authenticated;
grant execute on function public.find_similar_tender_memory(uuid, text, text, float, int) to service_role;

comment on function public.find_similar_tender_memory is
  'Doctrine V5 mémoire commerciale : retourne AO passés (won/lost) similaires au tender courant. Aucun score commercial, juste fait + tri perdus-d-abord pour mémoire mnemonique.';
