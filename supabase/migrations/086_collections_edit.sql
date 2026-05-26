-- Migration 086 : édition des collections documentaires (Vincent 2026-05-27).
-- 1) « place dans la liste » → colonne d'ordre `position` sur document_collections.
-- 2) « mettre les fichiers sans collection » → documents.collection_id devient
--    NULLABLE (un document orphelin = collection_id NULL, groupe « Sans collection »).
-- Idempotent (rebuild from scratch OK).

alter table public.document_collections
  add column if not exists position integer not null default 0;

-- Ordre initial stable : par date de création (les plus anciennes en premier).
update public.document_collections c
set position = sub.rn
from (
  select id, (row_number() over (order by created_at nulls last, id)) - 1 as rn
  from public.document_collections
) sub
where c.id = sub.id and c.position = 0;

create index if not exists idx_document_collections_position
  on public.document_collections (position);

-- collection_id nullable : permet « sans collection » (orphelin).
alter table public.documents
  alter column collection_id drop not null;
