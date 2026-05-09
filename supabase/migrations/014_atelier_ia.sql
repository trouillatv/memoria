-- Atelier IA — conversation contextualisée par AO + pièces jointes optionnelles

create table public.tender_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references tenders(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  agent_name  text,
  role        text not null check (role in ('user', 'agent', 'system')),
  content     text not null,
  metadata    jsonb,
  created_at  timestamptz default now()
);
create index tender_chat_messages_tender_idx on public.tender_chat_messages(tender_id, created_at);

create table public.tender_chat_attachments (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references tender_chat_messages(id) on delete cascade,
  storage_path   text not null,
  filename       text not null,
  size_bytes     int,
  extracted_text text,
  created_at     timestamptz default now()
);
create index tender_chat_attachments_message_idx on public.tender_chat_attachments(message_id);

-- RLS : héritent des règles tenders (manager + admin)
alter table public.tender_chat_messages enable row level security;
alter table public.tender_chat_attachments enable row level security;

create policy "chat messages manager admin all" on public.tender_chat_messages
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

create policy "chat attachments manager admin all" on public.tender_chat_attachments
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
