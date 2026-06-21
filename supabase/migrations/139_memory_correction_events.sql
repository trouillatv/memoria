-- =============================================================================
-- 139 — CAPTURE PASSIVE des corrections d'Émeline (Vincent 2026-06-21).
--
-- « Vous avez construit un système d'OBSERVATION de l'apprentissage. » Chaque
-- correction humaine est un exemple d'entraînement GRATUIT — et une fois le chantier
-- terminé, cette matière ne se reconstitue jamais. Donc on l'enregistre DÈS
-- MAINTENANT (pas d'IA, pas d'apprentissage, juste de l'instrumentation passive).
--
-- Grain = l'ÉDITION (≠ document_diffs mig 128 qui reste pour le couple version
-- générée ↔ version finale). Ici : un événement par champ corrigé.
--   { entity, field, category, op(added/edited/removed), before, after, qui, quand }
-- Sert plus tard : « corrections les plus fréquentes » (28% organismes…) → où investir ;
-- puis règles candidates (« quand ETV alors souvent BatiSud ») APRÈS volume, validées.
-- =============================================================================

create table if not exists public.memory_correction_events (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references public.site_reports(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete set null, -- dénormalisé : stats par site
  entity      text not null,        -- 'participant' | 'casting' | 'decision' | 'action' | 'point_action' | 'pv_item' | 'document_field' …
  field       text,                 -- 'organisme' | 'presence' | 'echeance' | 'titre' …
  category    text not null,        -- buckets de stats : 'organisation' | 'participant' | 'presence' | 'decision' | 'action' …
  op          text not null check (op in ('added', 'edited', 'removed')),
  before_val  text,
  after_val   text,
  actor_id    uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_correction_events_site on public.memory_correction_events(site_id);
create index if not exists idx_correction_events_report on public.memory_correction_events(report_id);
create index if not exists idx_correction_events_category on public.memory_correction_events(category);

alter table public.memory_correction_events enable row level security;
drop policy if exists "memory_correction_events read" on public.memory_correction_events;
create policy "memory_correction_events read" on public.memory_correction_events
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );
