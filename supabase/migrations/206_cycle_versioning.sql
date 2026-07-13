-- Migration 206 — LES VERSIONS d'un roulement.
--
-- Décision produit (Vincent, 2026-07-14) : un roulement est un CONTRAT de
-- planification — « à partir de telle date, cette équipe travaille selon ce
-- rythme ». Modifier un roulement publié n'a donc pas UN sens, il en a quatre :
--
--   « je me suis trompé »        → réécrire depuis le début ;
--   « à partir de maintenant »   → le passé reste vrai ;
--   « à partir de lundi »        → la semaine en cours reste vraie ;
--   « à partir du 1er septembre »→ on prépare la rentrée.
--
-- Dans les trois derniers cas, l'ancien rythme A EXISTÉ : il a produit des
-- interventions, des preuves, des décisions. Le réécrire mentirait sur le passé.
-- On le CLÔT donc (ends_on = veille de la date d'effet) et on crée une NOUVELLE
-- version qui démarre à la date d'effet.
--
-- Guillaume voit toujours « Roulement magasin ». MemorIA garde l'histoire :
--
--     Version 1   01/01 → 31/08
--     Version 2   01/09 → …
--
-- `supersedes_cycle_id` = la version que celle-ci remplace. Une chaîne, pas un
-- arbre : chaque version remplace au plus une autre.
--
-- Additif, idempotent. Rollback : DROP COLUMN. Aucune donnée existante impactée.

alter table public.planning_cycles
  add column if not exists supersedes_cycle_id uuid
    references public.planning_cycles(id) on delete set null;

create index if not exists planning_cycles_supersedes_idx
  on public.planning_cycles (supersedes_cycle_id)
  where supersedes_cycle_id is not null;

comment on column public.planning_cycles.supersedes_cycle_id is
  'La version que ce roulement remplace. L''ancienne version est close (ends_on = veille de la date d''effet), jamais réécrite : elle a produit des interventions et des preuves.';
