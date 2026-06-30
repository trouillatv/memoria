-- 179 — Harnais d'ÉVALUATION de la compréhension IA (Vincent 2026-06-30)
--
-- « Voilà ce que j'ai compris » n'est PAS livré comme une fonctionnalité mais
-- comme un PROTOCOLE D'ÉVALUATION : à chaque vraie prévisite, l'IA génère une
-- compréhension en AFFIRMATIONS ATOMIQUES (une idée notable chacune), reliées à
-- leur PROVENANCE (les items du read-model qui la soutiennent), et l'humain note
-- chaque affirmation sur la grille 4 classes (juste / trop vague / parasite /
-- dangereux, cf. [[jury-resonances-4-classes]]). Au bout de 15-20 visites = un
-- jeu de données labellisé sur ce que l'IA DOIT produire (≈ memory_correction_events
-- mais pour les claims de l'IA). C'est la boucle de validation terrain qui rend
-- le produit difficile à copier — pas un moteur de raisonnement de plus.
--
-- Un RUN = un instantané de compréhension d'un dossier (affaire) à un instant.
-- Régénérable ; deux runs permettront plus tard le DIFF (« ce qui a changé »),
-- diff calculé sur le read-model structuré, pas sur la prose.

create table if not exists public.comprehension_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid,
  dossier_id       uuid not null references public.dossiers(id) on delete cascade,
  site_id          uuid,
  provider         text,
  model            text,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists comprehension_runs_dossier_idx
  on public.comprehension_runs (dossier_id, created_at desc);

create table if not exists public.comprehension_affirmations (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.comprehension_runs(id) on delete cascade,
  organization_id  uuid,
  ordinal          int not null default 0,
  -- Rubrique de la lecture de reprise (le site / important / à vérifier / risque / poste).
  category         text not null default 'important',
  -- L'affirmation ATOMIQUE — une seule idée, notable d'un seul verdict.
  text             text not null check (length(text) <= 1000),
  -- Provenance : les items du read-model qui soutiennent l'affirmation (auditable).
  provenance       jsonb not null default '[]',
  -- Verdict humain (grille 4 classes) — null tant que non noté.
  verdict          text check (verdict in ('juste', 'vague', 'parasite', 'dangereux')),
  verdict_note     text,
  verdict_by       uuid references public.users(id) on delete set null,
  verdict_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists comprehension_affirmations_run_idx
  on public.comprehension_affirmations (run_id);

alter table public.comprehension_runs enable row level security;
alter table public.comprehension_affirmations enable row level security;

drop policy if exists "comprehension_runs read" on public.comprehension_runs;
create policy "comprehension_runs read" on public.comprehension_runs
  for select using (organization_id = public.current_user_org_id());

drop policy if exists "comprehension_affirmations read" on public.comprehension_affirmations;
create policy "comprehension_affirmations read" on public.comprehension_affirmations
  for select using (organization_id = public.current_user_org_id());

comment on table public.comprehension_runs is
  'Instantané de compréhension IA d''un dossier (mig 179) — harnais d''évaluation, pas une feature livrée. Régénérable ; base du diff futur. RLS read par org ; écriture service-role.';
comment on table public.comprehension_affirmations is
  'Affirmations atomiques d''une compréhension IA + leur provenance + le verdict humain 4 classes (mig 179). Jeu de données labellisé pour valider/faire évoluer l''IA.';
