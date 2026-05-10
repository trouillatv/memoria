-- Plan 3.9 — Add updated_at column to knowledge_items for freshness signal

alter table public.knowledge_items
  add column if not exists updated_at timestamptz default now();

-- Backfill : pour les rows existantes, updated_at = created_at
update public.knowledge_items
  set updated_at = created_at
  where updated_at is null;

-- Trigger pour auto-update à chaque UPDATE
create or replace function public.update_knowledge_items_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_items_updated_at on public.knowledge_items;
create trigger trg_knowledge_items_updated_at
  before update on public.knowledge_items
  for each row
  execute function public.update_knowledge_items_updated_at();
