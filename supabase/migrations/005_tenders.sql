-- Appels d'offres + documents + analyses IA versionnées

create table public.tenders (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  client_name       text,
  deadline          date,
  status            tender_status not null default 'draft',
  opportunity_score int,
  error_msg         text,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz default now(),
  deleted_at        timestamptz
);

create index tenders_status_idx on public.tenders(status) where deleted_at is null;

create table public.tender_documents (
  id             uuid primary key default gen_random_uuid(),
  tender_id      uuid not null references tenders(id) on delete cascade,
  storage_path   text not null,
  filename       text not null,
  size_bytes     int,
  page_count     int,
  extracted_text text,
  uploaded_at    timestamptz default now()
);

create index tender_documents_tender_idx on public.tender_documents(tender_id);

create table public.tender_analyses (
  id               uuid primary key default gen_random_uuid(),
  tender_id        uuid not null references tenders(id) on delete cascade,
  provider         ai_provider not null,
  model            text,
  prompt_versions  jsonb,
  summary          text,
  constraints      jsonb,
  risks            jsonb,
  checklist        jsonb,
  technical_memo   text,
  library_snapshot jsonb,
  raw_response     jsonb,
  created_at       timestamptz default now()
);

create index tender_analyses_tender_idx on public.tender_analyses(tender_id);
