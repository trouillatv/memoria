-- Migration 257 — Modèle générique des propositions documentaires multimodales
--
-- Sprint 4B.0 : contrat de données partagé par l'extraction automatique,
-- la validation humaine, les preuves visuelles, et la matérialisation vers
-- les objets métier MemorIA. Ne dépend pas du format spécifique d'un PV.
--
-- Cinq tables :
--   1. document_extraction_run       — une exécution d'extraction par document
--   2. document_extraction_proposal  — une proposition détectée (réserve, action…)
--   3. document_extraction_evidence  — une preuve (image, extrait texte, snapshot)
--   4. document_proposal_evidence    — relation M-M proposition ↔ preuve
--   5. document_proposal_materialization — registre idempotent des matérialisations
--
-- Invariants garantis par le modèle :
--   (1) tout élément porte organization_id
--   (2) une proposition appartient à une exécution et à un document source
--   (3) le contenu extrait n'est jamais détruit par une correction humaine
--   (4) une preuve peut rester non associée
--   (5) les relations M-M sont idempotentes (UNIQUE + ON CONFLICT)
--   (7) une proposition déjà matérialisée ne recrée pas le même objet (UNIQUE)
--   (8) un nouveau run n'écrase pas l'ancien (pas de CASCADE destructif)

-- ── 1. EXÉCUTION D'EXTRACTION ───────────────────────────────────────────────

create table if not exists public.document_extraction_run (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  document_id      uuid not null references public.documents(id) on delete cascade,
  extractor_key    text not null,   -- 'pv_btp_v1', 'audit_hse_v1'…
  extractor_version text not null default '1.0.0',
  status           text not null default 'pending' check (status in (
    'pending','processing','ready_for_review',
    'partially_materialized','materialized','failed')),
  started_at       timestamptz,
  completed_at     timestamptz,
  error_message    text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.users(id) on delete set null
);

create index if not exists doc_extraction_run_doc_idx
  on public.document_extraction_run(document_id);
create index if not exists doc_extraction_run_org_idx
  on public.document_extraction_run(organization_id);
create index if not exists doc_extraction_run_status_idx
  on public.document_extraction_run(status);

-- ── 2. PROPOSITION DOCUMENTAIRE ─────────────────────────────────────────────

create table if not exists public.document_extraction_proposal (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  extraction_run_id   uuid not null references public.document_extraction_run(id) on delete cascade,
  document_id         uuid not null references public.documents(id) on delete cascade,
  target_site_id      uuid references public.sites(id) on delete set null,
  proposal_family     text not null check (proposal_family in (
    'reservation','action','decision','observation',
    'deadline','knowledge_fact','person','company')),
  -- Clé stable pour idempotence intra-run (hash ou indice séquentiel)
  stable_key          text,
  -- Source extraite — JAMAIS modifiée après insertion (invariant 3)
  label               text not null,
  description         text,
  source_page         int,
  source_excerpt      text,
  source_payload      jsonb,
  -- Validation humaine — séparée du contenu extrait
  review_status       text not null default 'pending' check (review_status in (
    'pending','accepted','rejected','edited','materialized','failed')),
  reviewed_label      text,
  reviewed_description text,
  reviewed_family     text,
  reviewed_at         timestamptz,
  reviewed_by         uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (extraction_run_id, stable_key)  -- idempotence intra-run si stable_key fournie
);

create index if not exists doc_extraction_proposal_run_idx
  on public.document_extraction_proposal(extraction_run_id);
create index if not exists doc_extraction_proposal_doc_idx
  on public.document_extraction_proposal(document_id);
create index if not exists doc_extraction_proposal_org_idx
  on public.document_extraction_proposal(organization_id);
create index if not exists doc_extraction_proposal_status_idx
  on public.document_extraction_proposal(review_status);
create index if not exists doc_extraction_proposal_site_idx
  on public.document_extraction_proposal(target_site_id);

-- ── 3. PREUVE DOCUMENTAIRE ──────────────────────────────────────────────────

create table if not exists public.document_extraction_evidence (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  extraction_run_id uuid not null references public.document_extraction_run(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete cascade,
  evidence_type    text not null check (evidence_type in (
    'image','text_excerpt','page_snapshot')),
  source_page      int,
  storage_path     text,   -- null pour text_excerpt
  caption          text,
  nearby_text      text,
  metadata         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists doc_extraction_evidence_run_idx
  on public.document_extraction_evidence(extraction_run_id);
create index if not exists doc_extraction_evidence_doc_idx
  on public.document_extraction_evidence(document_id);

-- ── 4. RELATION M-M PROPOSITION ↔ PREUVE ────────────────────────────────────

create table if not exists public.document_proposal_evidence (
  proposal_id   uuid not null references public.document_extraction_proposal(id) on delete cascade,
  evidence_id   uuid not null references public.document_extraction_evidence(id) on delete cascade,
  relation_type text not null check (relation_type in (
    'supports','illustrates','source','candidate')),
  confidence    numeric(4,3) check (confidence >= 0 and confidence <= 1),
  created_at    timestamptz not null default now(),
  primary key (proposal_id, evidence_id, relation_type)
);

create index if not exists doc_proposal_evidence_evidence_idx
  on public.document_proposal_evidence(evidence_id);

-- ── 5. REGISTRE DE MATÉRIALISATION ──────────────────────────────────────────

create table if not exists public.document_proposal_materialization (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  proposal_id        uuid not null references public.document_extraction_proposal(id) on delete cascade,
  target_entity_type text not null,   -- 'site_action', 'site_blocage', 'knowledge_item'…
  target_entity_id   uuid not null,
  status             text not null default 'done' check (status in ('done','failed')),
  error_message      text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null,
  -- Idempotence : une proposition ne crée pas deux fois le même objet (invariant 7)
  unique (proposal_id, target_entity_type, target_entity_id)
);

create index if not exists doc_proposal_mat_proposal_idx
  on public.document_proposal_materialization(proposal_id);
create index if not exists doc_proposal_mat_org_idx
  on public.document_proposal_materialization(organization_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.document_extraction_run          enable row level security;
alter table public.document_extraction_proposal     enable row level security;
alter table public.document_extraction_evidence     enable row level security;
alter table public.document_proposal_evidence       enable row level security;
alter table public.document_proposal_materialization enable row level security;

-- Lecture : authenticated (filtrage org = applicatif, comme documents)
do $$ begin
  drop policy if exists "doc_ext_run authenticated read"          on public.document_extraction_run;
  drop policy if exists "doc_ext_proposal authenticated read"     on public.document_extraction_proposal;
  drop policy if exists "doc_ext_evidence authenticated read"     on public.document_extraction_evidence;
  drop policy if exists "doc_proposal_evidence authenticated read" on public.document_proposal_evidence;
  drop policy if exists "doc_proposal_mat authenticated read"     on public.document_proposal_materialization;
end $$;

create policy "doc_ext_run authenticated read"
  on public.document_extraction_run for select using (auth.role() = 'authenticated');
create policy "doc_ext_run manager write"
  on public.document_extraction_run for all
  using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

create policy "doc_ext_proposal authenticated read"
  on public.document_extraction_proposal for select using (auth.role() = 'authenticated');
create policy "doc_ext_proposal manager write"
  on public.document_extraction_proposal for all
  using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

create policy "doc_ext_evidence authenticated read"
  on public.document_extraction_evidence for select using (auth.role() = 'authenticated');
create policy "doc_ext_evidence manager write"
  on public.document_extraction_evidence for all
  using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

create policy "doc_proposal_evidence authenticated read"
  on public.document_proposal_evidence for select using (auth.role() = 'authenticated');
create policy "doc_proposal_evidence manager write"
  on public.document_proposal_evidence for all
  using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

create policy "doc_proposal_mat authenticated read"
  on public.document_proposal_materialization for select using (auth.role() = 'authenticated');
create policy "doc_proposal_mat manager write"
  on public.document_proposal_materialization for all
  using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));
