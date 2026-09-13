-- Migration 405 — Points, Couche 1.1 "Mémoire de revue" (mandat Vincent).
--
-- Mémorise, par utilisateur, la DERNIÈRE VERSION revue d'un Point. Une revue ne modifie
-- jamais tracked_point ni son état dérivé (jamais un statut métier) : elle répond uniquement
-- à "cet utilisateur a-t-il déjà revu CETTE VERSION des raisons de revue de ce Point ?".
--
-- review_fingerprint = signature déterministe produite par la primitive pure
-- computeTrackedPointReviewFingerprint (lib/knowledge/tracked-point-review.ts), à partir de
-- l'IDENTITÉ/VERSION stable de chaque raison active (date d'événement significatif, ids de
-- question NeedsYou, date du dernier PV, signaux canoniques triés) — jamais un texte généré,
-- jamais un compteur temporel (daysSinceLastEvent/passagesSinceEvent, qui changent à chaque
-- passage sans changement métier réel et feraient perpétuellement ressurgir un Point déjà revu).
--
-- Même doctrine que attention_signal_acknowledgements (mig 373) : upsert = mémoire de la
-- DERNIÈRE version revue, jamais un journal d'événements. Un signal matériellement nouveau
-- (nouvelle date d'événement, nouvelle question NeedsYou, nouveau PV, nouveau signal canonique)
-- produit un fingerprint différent et fait donc réapparaître le Point en revue.

create table if not exists public.tracked_point_reviews (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  site_id             uuid not null references public.sites(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  tracked_point_id    uuid not null references public.tracked_point(id) on delete cascade,
  review_fingerprint  text not null check (length(review_fingerprint) between 1 and 500),
  reviewed_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- Idempotence : un deuxième review sur le même (org, site, user, tracked_point_id) met à jour
-- la ligne existante (upsert on conflict), jamais une deuxième ligne — mémoire de la DERNIÈRE
-- version revue, pas un journal de clics.
create unique index if not exists tracked_point_review_uidx
  on public.tracked_point_reviews (organization_id, site_id, user_id, tracked_point_id);

create index if not exists tracked_point_review_lookup_idx
  on public.tracked_point_reviews (site_id, user_id);

comment on table public.tracked_point_reviews is
  'Points, Couche 1.1 "Mémoire de revue" : mémorise la dernière version (review_fingerprint) des raisons de revue qu''un utilisateur a explicitement traitée pour un Point. Ne modifie jamais tracked_point ni son état dérivé.';
comment on column public.tracked_point_reviews.review_fingerprint is
  'Signature déterministe des raisons de revue actives au moment de la revue (cf. computeTrackedPointReviewFingerprint, lib/knowledge/tracked-point-review.ts). Jamais de texte généré, jamais un compteur temporel (daysSince.../passagesSince...).';

-- Service role uniquement (repository server-side seulement, pattern mig 373) : les
-- repositories filtrent toujours organization_id/site_id/user_id.
alter table public.tracked_point_reviews enable row level security;
drop policy if exists "service_role_full_access" on public.tracked_point_reviews;
create policy "service_role_full_access" on public.tracked_point_reviews
  for all using (auth.role() = 'service_role');
