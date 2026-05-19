-- Migration 073 — Architecture documentaire générique (phase 1)
--
-- Spec : docs/superpowers/specs/2026-05-19-document-lifecycle-design.md
-- Ratifié A–K (Vincent 2026-05-19). Additif, idempotent, NON destructif
-- (discipline 071/072). Le document = nœud du graphe mémoire, branché sur le
-- RAG EXISTANT (knowledge_chunks) — on N'ajoute PAS de RAG, on étend l'enum.
--
-- Décisions matérialisées :
--  A documents + document_links polymorphe (pas *_documents par entité)
--  B document_type enum + tags
--  C collection OBLIGATOIRE à l'upload (documents.collection_id NOT NULL)
--  D cycle de vie : status + supersedes_document_id + effective/expires
--  E pipeline réutilisé : source_domain += 'document' (knowledge_chunks)
--  G/J visibility_level (filtrage fin = applicatif + chunk metadata ; RLS
--      rôle grossier comme tout le repo ; audit = Server Action, pas SQL)
--  I analysis_status explicite + failed_reason + extraction_source
--  K content_hash (dédup roadmap)

-- 1. Bucket privé (idiome 010_buckets.sql)
insert into storage.buckets (id, name, public) values
  ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "documents read for authenticated" on storage.objects;
create policy "documents read for authenticated"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- 2. Collections (C : référencées NOT NULL par documents)
create table if not exists public.document_collections (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,
  name        text not null,
  scope_type  text,   -- contract|site|tender|client|tenant — organisationnel
  scope_id    uuid,
  created_at  timestamptz default now(),
  deleted_at  timestamptz
);

-- 3. Documents (nœud mémoire)
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  collection_id   uuid not null references public.document_collections(id),
  document_type   text not null check (document_type in (
    'contrat','avenant','procedure','protocole','plan_acces','securite',
    'ao','memoire_technique','reference','litige','facture','preuve','autre')),
  tags            text[] not null default '{}',
  visibility_level text not null default 'manager' check (visibility_level in (
    'admin_only','manager','operations','field','client_portal')),
  status          text not null default 'active' check (status in (
    'active','superseded','expired','archived')),
  supersedes_document_id uuid references public.documents(id),
  effective_date  date,
  expires_date    date,
  -- pipeline (I) : analysé UNE fois, jamais à l'affichage
  analysis_status text not null default 'pending' check (analysis_status in (
    'pending','ocr','extracting','chunking','ready','failed')),
  failed_reason   text,
  extraction_source text check (extraction_source in ('native','ocr')),
  extracted_text  text,
  -- fichier
  storage_path    text not null,
  filename        text not null,
  size_bytes      int,
  page_count      int,
  content_hash    text,   -- K : sha256 du binaire (dédup roadmap)
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz
);
create index if not exists documents_collection_idx on public.documents(collection_id);
create index if not exists documents_tenant_idx     on public.documents(tenant_id);
create index if not exists documents_status_idx      on public.documents(status);
create index if not exists documents_analysis_idx    on public.documents(analysis_status);
create index if not exists documents_hash_idx        on public.documents(content_hash)
  where content_hash is not null;

-- 4. Liens polymorphes (A) — un doc rattachable à plusieurs entités
create table if not exists public.document_links (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  target_type  text not null check (target_type in (
    'contract','site','tender','client','intervention','team','tenant')),
  target_id    uuid not null,
  created_at   timestamptz default now(),
  unique (document_id, target_type, target_id)
);
create index if not exists document_links_target_idx on public.document_links(target_type, target_id);
create index if not exists document_links_doc_idx    on public.document_links(document_id);

-- 5. tenant_id défaut single-tenant (idiome 061_sites_tenant_id.sql)
do $$
declare v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
    from public.sites where tenant_id is not null limit 1;
  if v_tenant_id is not null then
    execute format('alter table public.documents alter column tenant_id set default %L', v_tenant_id);
    execute format('alter table public.document_collections alter column tenant_id set default %L', v_tenant_id);
    update public.documents           set tenant_id = v_tenant_id where tenant_id is null;
    update public.document_collections set tenant_id = v_tenant_id where tenant_id is null;
  end if;
end $$;

-- 6. RLS rôle (idiome 011) — lecture authenticated, écriture admin/manager.
--    Filtrage fin par visibility_level = applicatif + propagé au chunk
--    metadata (décision J). Audit ouverture/téléchargement = Server Action
--    (décision G), jamais relâché.
alter table public.documents            enable row level security;
alter table public.document_collections enable row level security;
alter table public.document_links       enable row level security;

drop policy if exists "documents authenticated read" on public.documents;
create policy "documents authenticated read" on public.documents
  for select using (auth.role() = 'authenticated');
drop policy if exists "documents manager admin write" on public.documents;
create policy "documents manager admin write" on public.documents
  for all using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

drop policy if exists "doc_collections authenticated read" on public.document_collections;
create policy "doc_collections authenticated read" on public.document_collections
  for select using (auth.role() = 'authenticated');
drop policy if exists "doc_collections manager admin write" on public.document_collections;
create policy "doc_collections manager admin write" on public.document_collections
  for all using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

drop policy if exists "doc_links authenticated read" on public.document_links;
create policy "doc_links authenticated read" on public.document_links
  for select using (auth.role() = 'authenticated');
drop policy if exists "doc_links manager admin write" on public.document_links;
create policy "doc_links manager admin write" on public.document_links
  for all using (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

-- 7. RAG : le document se branche sur knowledge_chunks existant (décision E).
--    source_domain est un CHECK text (pas un enum PG) → drop/add idempotent.
alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_source_domain_check;
alter table public.knowledge_chunks
  add constraint knowledge_chunks_source_domain_check
  check (source_domain in ('library', 'tender_history', 'document'));

comment on table public.documents is
  'V6.3+ — nœud du graphe mémoire documentaire. Analysé UNE fois '
  '(analysis_status), jamais re-lu à l''affichage. Indexé dans '
  'knowledge_chunks (source_domain=document). Accès gradué visibility_level '
  '+ audit obligatoire. Jamais indexé par personne (doctrine V6.2/V6.8).';
comment on column public.documents.visibility_level is
  'Décision J — accès gradué (admin_only|manager|operations|field|'
  'client_portal), propagé au chunk metadata pour borner le recall RAG.';
comment on column public.documents.analysis_status is
  'Décision I — pipeline async : pending→ocr?→extracting→chunking→ready|'
  'failed. Relance = action explicite « Réanalyser », jamais au render.';
