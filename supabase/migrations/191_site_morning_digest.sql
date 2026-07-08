-- 191 — site_morning_digest : « la Nuit de MemorIA » (Vincent 2026-07-08)
--
-- Le métabolisme nocturne : chaque nuit, un cron rejoue les détecteurs mémoire
-- déterministes (lib/db/site-memory-signals) sur chaque chantier actif et
-- persiste le résultat ici. Le matin, le dashboard LIT ce digest au lieu de
-- recalculer à chaque page — le Temps 2 (moteur de surfaçage) a enfin un
-- battement de cœur, et UNE seule apparition : le matin.
--
-- INVARIANTS (à ne jamais casser) :
--   * Donnée DÉRIVÉE et reconstructible — jamais une source de vérité. Tout ce
--     qui est ici se recalcule depuis les tables métier (read-model persisté,
--     cf. [[moteur-de-contexte-chantier]]). On peut TRUNCATE sans rien perdre.
--   * Un digest VIDE est écrit aussi (signal_count = 0) : il distingue
--     « rien à signaler » (silence vert assumé) de « pas encore calculé ».
--   * Zéro LLM dans ce pipeline — détecteurs 100 % déterministes.
--   * Rétention courte (purge > 30 j par le cron) : le digest sert LE matin,
--     l'historique vit dans les tables métier.

create table if not exists public.site_morning_digest (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid,
  site_id         uuid not null references public.sites(id) on delete cascade,
  -- Date civile NOUMÉA du matin que ce digest sert (pas la date UTC du calcul).
  digest_date     date not null,
  -- MemorySignal[] sérialisés (lib/db/site-memory-signals) — kind/title/items/source.
  signals         jsonb not null default '[]'::jsonb,
  signal_count    int not null default 0,
  computed_at     timestamptz not null default now(),
  duration_ms     int,
  unique (site_id, digest_date)
);

create index if not exists site_morning_digest_org_date_idx
  on public.site_morning_digest(organization_id, digest_date);

alter table public.site_morning_digest enable row level security;
drop policy if exists "site_morning_digest read" on public.site_morning_digest;
create policy "site_morning_digest read" on public.site_morning_digest
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );
-- Écriture : service-role uniquement (le cron de la Nuit), pas de policy insert/update.

comment on table public.site_morning_digest is
  'Digest nocturne par chantier (mig 191, « la Nuit de MemorIA ») : résultat persisté des détecteurs mémoire déterministes, calculé chaque nuit (cron night-digest) pour la date civile Nouméa du matin servi. Donnée DÉRIVÉE et reconstructible, jamais source de vérité ; digest vide écrit aussi (silence vert assumé) ; purge > 30 j. RLS read par org ; écriture service-role.';
