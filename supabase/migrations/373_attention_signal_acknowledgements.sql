-- Migration 373 — Débrief D3 : persistance de l'acquittement ("Vu") d'un signal
-- informationnel canonical.
--
-- Un ack ne représente jamais un statut métier : il ne modifie ni
-- canonical_subject, ni Action/Échéance/Réserve. Il répond uniquement à
-- « cet utilisateur a-t-il déjà vu CETTE VERSION informationnelle de ce
-- sujet ? » — pas « ne plus jamais me parler de ce sujet ».
--
-- signal_key = canonicalSubjectId + ensemble trié des CanonicalSignal (cf.
-- buildDebriefSignalKey, lib/knowledge/live-debrief.ts). Un développement
-- matériellement nouveau sur un sujet déjà vu (ex. stagnant -> stagnant +
-- pv_aggrave) produit une clé différente et redevient donc non-vu. Jamais de
-- texte généré (title/reasons) dans la clé.

create table if not exists public.attention_signal_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  signal_key       text not null check (length(signal_key) between 1 and 500),
  seen_at          timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Idempotence : un deuxième markSeen sur le même (org, site, user, signal_key)
-- met à jour la ligne existante (upsert on conflict), jamais une deuxième ligne.
-- org_id porté explicitement dans l'unicité : le cloisonnement tenant doit être
-- garanti par le contrat de données, pas seulement déduit de site_id.
create unique index if not exists attention_signal_ack_uidx
  on public.attention_signal_acknowledgements (organization_id, site_id, user_id, signal_key);

create index if not exists attention_signal_ack_lookup_idx
  on public.attention_signal_acknowledgements (site_id, user_id);

comment on table public.attention_signal_acknowledgements is
  'Débrief D3 : "cet utilisateur a vu cette version informationnelle de ce sujet", jamais un statut métier. signal_key = canonicalSubjectId + signaux triés (buildDebriefSignalKey) ; un changement matériel de signaux produit une nouvelle clé et redevient non-vu.';
comment on column public.attention_signal_acknowledgements.signal_key is
  'canonicalSubjectId + ensemble trié des CanonicalSignal (cf. buildDebriefSignalKey, lib/knowledge/live-debrief.ts). Jamais de texte généré (title/reasons).';

-- Service role uniquement, comme les autres objets site-scoped écrits par les
-- repositories server-side (cf. site_planning_items, mig 370) ; les repositories
-- filtrent toujours org/site/user.
alter table public.attention_signal_acknowledgements enable row level security;
drop policy if exists "service_role_full_access" on public.attention_signal_acknowledgements;
create policy "service_role_full_access" on public.attention_signal_acknowledgements
  for all using (auth.role() = 'service_role');
