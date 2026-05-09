-- Logs d'usage IA (tracking coût par feature/agent)

create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  feature       text not null,
  provider      ai_provider not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10, 6),
  duration_ms   int,
  status        text not null,
  error_msg     text,
  created_at    timestamptz default now()
);

create index ai_usage_user_idx       on public.ai_usage(user_id);
create index ai_usage_created_at_idx on public.ai_usage(created_at desc);
create index ai_usage_feature_idx    on public.ai_usage(feature);
