-- ===========================================================
-- Migration 079 — Handover briefs · passages de témoin (Vincent 2026-05-22)
--
-- Sprint Équipes C : « le killer feature ».
--
-- Quand quelqu'un quitte/change d'équipe OU qu'une équipe prend un nouveau
-- site, MemorIA compile automatiquement la mémoire utile à transmettre :
-- sites connus, consignes "À savoir", dernières anomalies, contacts client,
-- documents rattachés. Snapshot stocké en JSONB (résiste aux changements
-- ultérieurs : un brief lu dans 6 mois reflète ce qui était vrai au moment T).
--
-- Doctrine V2 — le brief documente LE SITE et CE QUE L'ÉQUIPE PRENANTE DOIT
-- SAVOIR. Jamais la personne qui s'en va :
--   ✅ « Ce qu'il faut savoir sur ces 4 sites »
--   ✅ « Consignes À savoir, anomalies récentes, accès, contacts client »
--   ❌ PAS « Untel faisait bien / mal »
--   ❌ PAS « raisons du départ »
--   ❌ PAS de notation, score ou évaluation
--
-- Cycle de vie : draft → shared → acknowledged → archived (soft).
-- Token public optionnel (URL signée expirable, comme proof_share_tokens).
-- ===========================================================

create table public.handover_briefs (
  id               uuid primary key default gen_random_uuid(),

  -- Type de passage de témoin
  kind             text not null
    check (kind in ('member_change', 'team_takes_site', 'manual')),

  -- Sujets (NULLABILITÉ selon `kind`, voir CHECK ci-dessous)
  source_team_id   uuid references public.teams(id) on delete set null,
  target_team_id   uuid references public.teams(id) on delete set null,
  subject_user_id  uuid references public.users(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,

  -- Snapshot : contenu compilé au moment T. Résiste aux changements ultérieurs.
  --   { generatedAt, sites: [...], anomalies: [...], documents: [...], ... }
  payload          jsonb not null,
  title            text not null check (char_length(title) between 1 and 200),

  -- Cycle de vie
  status           text not null default 'draft'
    check (status in ('draft', 'shared', 'acknowledged', 'archived')),

  -- Partage public (optionnel, calé sur le pattern proof_share_tokens)
  shared_token     text unique,
  shared_at        timestamptz,
  expires_at       timestamptz,
  last_accessed_at timestamptz,
  access_count     integer not null default 0,

  -- Accusé de réception
  acknowledged_by  uuid references public.users(id) on delete set null,
  acknowledged_at  timestamptz,

  -- Audit
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

comment on table public.handover_briefs is
  'Vincent 2026-05-22 — Snapshots de passage de témoin (équipe → équipe, ou prise de site). Documente le SITE et la mémoire utile, jamais la personne qui part. Payload immuable post-création.';

comment on column public.handover_briefs.kind is
  'member_change : membre bascule (départ équipe A, arrivée équipe B) — payload = sites connus + à savoir. team_takes_site : équipe prend un nouveau site — payload = historique site + voisins. manual : brief ad-hoc.';

comment on column public.handover_briefs.payload is
  'Snapshot JSONB du contenu au moment de la génération. NE PAS modifier après création (un brief de mars 2026 doit refléter mars 2026 même si lu en juin).';

comment on column public.handover_briefs.shared_token is
  'Token URL-safe pour partage public /h/[token]. Optionnel. Pattern aligné sur proof_share_tokens.';

-- ----------------------------------------------------------------------------
-- Cohérence kind ↔ sujets (CHECK)
-- ----------------------------------------------------------------------------
alter table public.handover_briefs add constraint chk_handover_kind_subjects check (
  case kind
    when 'member_change' then subject_user_id is not null
    when 'team_takes_site' then target_team_id is not null and site_id is not null
    when 'manual' then true
  end
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index idx_handover_briefs_status
  on public.handover_briefs(status)
  where deleted_at is null;

create index idx_handover_briefs_subject_user
  on public.handover_briefs(subject_user_id)
  where subject_user_id is not null and deleted_at is null;

create index idx_handover_briefs_target_team
  on public.handover_briefs(target_team_id)
  where target_team_id is not null and deleted_at is null;

create index idx_handover_briefs_site
  on public.handover_briefs(site_id)
  where site_id is not null and deleted_at is null;

create index idx_handover_briefs_shared_token
  on public.handover_briefs(shared_token)
  where shared_token is not null and deleted_at is null;

create index idx_handover_briefs_created_at
  on public.handover_briefs(created_at desc)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- RLS — admin + manager full CRUD ; route publique /h/[token] passe par
-- service_role côté server, donc pas de policy pour anonymes.
-- ----------------------------------------------------------------------------
alter table public.handover_briefs enable row level security;

drop policy if exists "handover_briefs admin manager full" on public.handover_briefs;
create policy "handover_briefs admin manager full"
  on public.handover_briefs
  for all
  using      (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
