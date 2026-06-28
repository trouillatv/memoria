-- 172 — dossiers : l'OPÉRATION comme identité métier (Vincent 2026-06-29)
--
-- CORRECTION STRUCTURELLE de mig 171. Le SITE est un LIEU physique durable ;
-- l'OPÉRATION (un marché, une réno, une maintenance) est une histoire qui naît à
-- la prévisite et va jusqu'au DOE. Un même lieu porte PLUSIEURS opérations dans le
-- temps (AO 2026 perdu, réno 2028 gagnée, maintenance 2032) — parfois en parallèle.
-- Donc la PHASE appartient au DOSSIER, pas au site (site.phase ne sait pas dire
-- « deux histoires à la fois »).
--
--   Site (lieu, mémoire PERMANENTE et partagée : pièges, accès, contraintes)
--     └── Dossier (opération, mémoire d'UNE histoire : prévisite→AO→contrat→DOE)
--           └── Sujet (point/problème suivi)
--
-- TRANSITION (Vincent) : on N'EFFACE PAS site.phase (mig 171). On arrête juste de
-- s'en servir comme identité ; il reste un garde transitoire pour masquer un lieu
-- purement prospect de la grille chantier, le temps de migrer. Nettoyage ensuite.
--
-- La continuité (le moat) = la mémoire de LIEU s'injecte dans chaque nouveau
-- dossier (readForTender lit les à-savoir du site). Cf. [[contexte-ao-dossier-vivant]],
-- [[dossier-opportunite-colonne-vertebrale]].

create table if not exists public.dossiers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,
  -- Le lieu partagé. Plusieurs dossiers par site dans le temps.
  site_id         uuid not null references public.sites(id) on delete cascade,
  -- Le donneur d'ordre de CETTE opération (peut différer d'un dossier à l'autre).
  client_id       uuid references public.clients(id) on delete set null,
  -- Nature de l'opération — label EXTENSIBLE (ao | operation | maintenance | reno …).
  type            text not null default 'operation',
  -- Phase de vie de l'OPÉRATION (déplacée depuis sites.phase).
  phase           text not null default 'prospect'
                    check (phase in ('prospect', 'en_ao', 'actif', 'perdu', 'archive')),
  label           text,
  opened_at       timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists dossiers_site_idx on public.dossiers(site_id) where deleted_at is null;
create index if not exists dossiers_phase_idx on public.dossiers(phase) where deleted_at is null;

alter table public.dossiers enable row level security;
drop policy if exists "dossiers read" on public.dossiers;
create policy "dossiers read" on public.dossiers
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

-- Rattachement des objets d'OPÉRATION au dossier (nullable : la donnée existante
-- reste site-keyed et continue de fonctionner ; on stampe au fil de l'eau).
alter table public.site_reports      add column if not exists dossier_id uuid references public.dossiers(id) on delete set null;
alter table public.visit_capture     add column if not exists dossier_id uuid references public.dossiers(id) on delete set null;
alter table public.captured_knowledge add column if not exists dossier_id uuid references public.dossiers(id) on delete set null;

create index if not exists site_reports_dossier_idx      on public.site_reports(dossier_id)      where dossier_id is not null;
create index if not exists visit_capture_dossier_idx     on public.visit_capture(dossier_id)     where dossier_id is not null;
create index if not exists captured_knowledge_dossier_idx on public.captured_knowledge(dossier_id) where dossier_id is not null;

comment on table public.dossiers is
  'Opération métier (mig 172) = l''identité de mémoire entre le Site (lieu durable) et le Sujet (point suivi). Naît à la prévisite (phase prospect) et va jusqu''au DOE sans changer d''identité ; un même site porte N dossiers dans le temps. La phase vit ICI (plus sur sites). La mémoire de lieu (site_notes/à-savoir) reste sur le site et s''injecte dans chaque dossier. RLS read par org ; écriture service-role.';
