-- Migration 020 : Cross-tender matching infrastructure
--
-- Goal : permettre le matching de similarité textuelle entre clauses d'un nouvel AO
-- et engagements passés actifs/completed.
--
-- Approche : Postgres pg_trgm (trigrammes) — suffisant pour matching de clauses
-- cleaning, pas besoin d'embeddings vectoriels en MVP.
--
-- Spec : Phase 4 — Cross-tender matching, the moat closer

-- ==========================================
-- Enable pg_trgm extension (Supabase has it available in `extensions` schema)
-- ==========================================
create extension if not exists pg_trgm with schema extensions;

-- ==========================================
-- GIN indexes for fast similarity search
-- ==========================================
-- source_excerpt : la citation verbatim, le champ le plus pertinent pour matching
create index if not exists engagements_source_excerpt_trgm_idx
  on public.engagements
  using gin (source_excerpt extensions.gin_trgm_ops)
  where status in ('active', 'completed');

-- short_label : reformulation courte, secondaire mais utile
create index if not exists engagements_short_label_trgm_idx
  on public.engagements
  using gin (short_label extensions.gin_trgm_ops)
  where status in ('active', 'completed');

-- ==========================================
-- RPC function : find_similar_engagements
-- ==========================================
-- Returns engagements active/completed similar to the query text,
-- ordered by similarity desc. Optionally excludes a specific tender.
--
-- Note : pg_trgm functions live in the `extensions` schema on Supabase.
-- We keep `set search_path = ''` (doctrine cohérente avec migrations 012, 017, 018)
-- and fully qualify all references (extensions.similarity, public.engagements,
-- public.engagement_*).
create or replace function public.find_similar_engagements(
  p_query text,
  p_threshold float default 0.3,
  p_limit int default 10,
  p_exclude_tender_id uuid default null
)
returns table (
  id uuid,
  tender_id uuid,
  contract_id uuid,
  source_type public.engagement_source_type,
  source_excerpt text,
  source_ref jsonb,
  category public.engagement_category,
  short_label text,
  measurable boolean,
  ai_confidence numeric,
  status public.engagement_status,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  similarity float
)
language sql
security definer
set search_path = ''
as $$
  select
    e.id, e.tender_id, e.contract_id, e.source_type, e.source_excerpt,
    e.source_ref, e.category, e.short_label, e.measurable, e.ai_confidence,
    e.status, e.created_at, e.updated_at, e.created_by,
    -- Use the GREATEST similarity between source_excerpt and short_label
    greatest(
      extensions.similarity(e.source_excerpt, p_query),
      extensions.similarity(e.short_label, p_query)
    ) as similarity
  from public.engagements e
  where e.status in ('active', 'completed')
    and (p_exclude_tender_id is null or e.tender_id <> p_exclude_tender_id)
    and (
      extensions.similarity(e.source_excerpt, p_query) >= p_threshold
      or extensions.similarity(e.short_label, p_query) >= p_threshold
    )
  order by similarity desc
  limit p_limit;
$$;

-- Grant execute to authenticated users + service_role
-- (RLS on engagements remains enforced because the function does not bypass it
-- on the calling client; security definer here scopes the search_path only.)
grant execute on function public.find_similar_engagements(text, float, int, uuid) to authenticated;
grant execute on function public.find_similar_engagements(text, float, int, uuid) to service_role;
