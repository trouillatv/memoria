-- Slice B.3 — Tokens de partage pour les Dossiers de preuves
--
-- Doctrine impérative :
--   - Usage : partage temporaire avec client/auditeur. Pas un "tracking lien".
--   - Anonymisation par défaut. La colonne include_identities est un override
--     admin uniquement, traçable via audit log.
--   - Token URL-safe (base64url) généré server-side. Pas de "secret signé" maison.
--   - Expiration obligatoire (NOT NULL). Pas de partage perpétuel.
--   - Soft-revoke possible (revoked_at) : le lien rejoint le néant immédiatement,
--     mais l'audit conserve la trace.
--
-- Suite : Slice B.4 — route publique /p/[token] anonymisée.

create table public.proof_share_tokens (
    id                 uuid primary key default gen_random_uuid(),
    token              text unique not null,
    intervention_id    uuid not null references public.interventions(id) on delete cascade,
    created_at         timestamptz not null default now(),
    created_by         uuid references public.users(id) on delete set null,
    expires_at         timestamptz not null,
    revoked_at         timestamptz,
    include_identities boolean not null default false,
    last_accessed_at   timestamptz,
    access_count       integer not null default 0
);

comment on table public.proof_share_tokens is
  'Tokens de partage temporaire des Dossiers de preuves. Anonymisation par défaut, expiration obligatoire.';

comment on column public.proof_share_tokens.token is
  'Token cryptographique unique URL-safe (~32 chars). Généré server-side via crypto.randomBytes(24).toString("base64url").';

comment on column public.proof_share_tokens.intervention_id is
  'Intervention référencée. ON DELETE CASCADE : supprimer l''intervention purge les tokens.';

comment on column public.proof_share_tokens.expires_at is
  'Expiration obligatoire. Default applicatif : +7 jours. Max raisonnable : +30 jours.';

comment on column public.proof_share_tokens.revoked_at is
  'Révocation immédiate du token. NULL = encore actif (si non expiré).';

comment on column public.proof_share_tokens.include_identities is
  'Override admin : si true, le PDF et la page publique affichent les identités des agents. Audit logged.';

comment on column public.proof_share_tokens.last_accessed_at is
  'Horodatage du dernier accès via /p/[token]. Mis à jour par recordShareAccess().';

comment on column public.proof_share_tokens.access_count is
  'Compteur d''accès cumulé. Incrémenté par recordShareAccess().';

-- Index pour lookups fréquents
create index idx_proof_share_tokens_intervention
  on public.proof_share_tokens(intervention_id);

-- Lookup principal côté route publique : retrouver le token actif par sa valeur.
-- Filtré partiel : on cherche presque toujours les tokens non révoqués.
create index idx_proof_share_tokens_token
  on public.proof_share_tokens(token)
  where revoked_at is null;

-- Index pour balayer les tokens proches d'expirer (cron de nettoyage éventuel).
create index idx_proof_share_tokens_active
  on public.proof_share_tokens(expires_at)
  where revoked_at is null;

-- RLS — admin/manager CRUD complet. La route publique /p/[token] utilisera
-- l'admin client (service role) côté serveur pour lire le token sans RLS.
alter table public.proof_share_tokens enable row level security;

drop policy if exists "proof_share_tokens admin manager full" on public.proof_share_tokens;
create policy "proof_share_tokens admin manager full"
  on public.proof_share_tokens
  for all
  using      (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
