-- Plan 3.6 — Analyses par agent metier sur un AO
-- Une row par (tender_id, agent_name) : chaque agent peut produire sa propre
-- analyse initiale du document. Status badges sur la sidebar Atelier IA.

create type agent_analysis_status as enum ('pending', 'running', 'ready', 'failed');

create table public.tender_agent_analyses (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references tenders(id) on delete cascade,
  agent_name  text not null,
  status      agent_analysis_status not null default 'pending',
  summary     text,                          -- résumé court (3-5 phrases) de la perspective de l'agent
  key_points  jsonb,                         -- bullets : risks, opportunities, key_metrics, etc. (shape libre par agent)
  raw_content text,                          -- markdown long si l'agent en produit
  metadata    jsonb,                         -- provider, model, tokens, durée
  error_msg   text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (tender_id, agent_name)
);

create index tender_agent_analyses_tender_idx on public.tender_agent_analyses(tender_id);

alter table public.tender_agent_analyses enable row level security;

create policy "agent analyses manager admin all" on public.tender_agent_analyses
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
