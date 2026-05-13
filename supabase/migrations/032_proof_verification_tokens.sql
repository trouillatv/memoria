-- ============================================================================
-- Migration 032 — proof_verification_tokens (Slice S3, Doctrine V5 Pilier 6)
-- ============================================================================
--
-- Token PERMANENT (jamais d'expiration) qui permet à un client (Sylvie) de
-- VÉRIFIER L'AUTHENTICITÉ d'un document NetoIAge même après expiration du
-- share_token temporaire.
--
-- Page publique `/v/[token]` :
--   - Affiche : "Document authentique émis le {created_at} par {tenantName}"
--   - N'affiche PAS le contenu du document (qui peut avoir été révoqué)
--   - Pas d'auth requise (publique, vérification = preuve d'existence)
--
-- Le QR code des PDF pointe vers `/v/[verification_token]`, PAS vers
-- `/p/[share_token]`. Ainsi un PDF imprimé et conservé 3 ans peut toujours
-- être vérifié même si le share_token original a expiré.
--
-- Constraint XOR : un token vérifie SOIT une intervention (dossier de preuves),
-- SOIT un rapport mensuel (contract + month), jamais les deux.

create table public.proof_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  -- Cible : intervention (dossier de preuves) OU rapport mensuel
  intervention_id uuid references public.interventions(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  report_month text,
  -- Token public stable (URL-safe, 32 chars hex)
  token text unique not null,
  -- Tenant émetteur (pour affichage humain sur /v/[token])
  tenant_name text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  -- XOR : intervention XOR (contract + report_month)
  constraint chk_vt_target_xor check (
    (intervention_id is not null and contract_id is null and report_month is null)
    or
    (intervention_id is null and contract_id is not null and report_month is not null)
  )
);

comment on table public.proof_verification_tokens is
  'Slice S3 / Doctrine V5 Pilier 6 — Token PERMANENT pour vérifier l''authenticité '
  'd''un document NetoIAge même après expiration de son share_token temporaire. '
  'Référencé par les QR codes PDF (URL stable /v/[token]).';

comment on column public.proof_verification_tokens.token is
  'Token public URL-safe, ne change jamais. Aucune sensibilité — sert juste à '
  'matérialiser une preuve d''existence du document.';

-- Index pour les jointures par target
create index idx_proof_verification_tokens_intervention
  on public.proof_verification_tokens(intervention_id)
  where intervention_id is not null;

create index idx_proof_verification_tokens_contract_month
  on public.proof_verification_tokens(contract_id, report_month)
  where contract_id is not null;

-- RLS : lecture publique (anyone peut vérifier). Pas d'écriture/delete sauf admin.
alter table public.proof_verification_tokens enable row level security;

create policy "verification_tokens_public_read"
  on public.proof_verification_tokens
  for select
  using (true);

create policy "verification_tokens_admin_write"
  on public.proof_verification_tokens
  for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Pas de policy delete : tokens permanents, jamais supprimés (excepté via cascade
-- depuis intervention/contract supprimé).
