-- 175 — soudure AVANT : un AO se rattache à une OPPORTUNITÉ (Vincent 2026-06-29)
--
-- Décision : dossier = opportunity (MVP, pas de niveau parent). Le tender n'est PAS
-- le cœur — c'est un ÉPISODE rattaché à l'opportunité. Relation : un dossier a 0..N
-- tenders (souvent 1) ; un tender appartient à 0..1 dossier. Aucune copie de données :
-- l'AO référence l'opportunité, la mémoire reste portée par le dossier.

alter table public.tenders
  add column if not exists dossier_id uuid references public.dossiers(id) on delete set null;

create index if not exists tenders_dossier_idx
  on public.tenders(dossier_id) where dossier_id is not null;
