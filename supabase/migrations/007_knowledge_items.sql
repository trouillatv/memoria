-- Bibliothèque AGP — table unifiée minimale

create table public.knowledge_items (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  category         knowledge_category not null,
  content_markdown text not null,
  file_path        text,
  tags             text[],
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);

create index knowledge_items_category_idx on public.knowledge_items(category) where deleted_at is null;
create index knowledge_items_tags_idx     on public.knowledge_items using gin(tags) where deleted_at is null;
