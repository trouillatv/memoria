-- Slice E.2 — Extension proof_share_tokens pour rapport mensuel client.
--
-- Doctrine impérative anti-rapport bullshit V4 :
--   - Pas de nouvelle table : on étend la table existante (proof_share_tokens
--     migration 022) plutôt que dupliquer une logique de share token.
--   - Une ligne = soit un partage de dossier de preuves (intervention_id),
--     soit un partage de rapport mensuel (contract_id + report_month).
--     CHECK chk_token_kind impose le XOR strict.
--   - selected_photo_ids = sélection figée du DG au moment de l'approbation
--     (jusqu'à 12 photos, héritées du cap applicatif Slice E.1).
--   - dg_note = note libre du DG figée (300 chars max applicatif).
--   - intervention_id devient nullable pour autoriser le cas rapport mensuel.
--
-- Suite : helpers DB createMonthlyReportToken + getMonthlyReportFromToken,
-- puis génération PDF + route publique /p/[token] étendue.

alter table public.proof_share_tokens
  add column contract_id uuid references public.contracts(id) on delete cascade,
  add column report_month text,
  add column selected_photo_ids uuid[],
  add column dg_note text;

alter table public.proof_share_tokens
  alter column intervention_id drop not null;

-- XOR strict : soit dossier de preuves (intervention_id), soit rapport mensuel
-- (contract_id + report_month). Jamais les deux, jamais aucun.
alter table public.proof_share_tokens
  add constraint chk_token_kind check (
    (intervention_id is not null and contract_id is null and report_month is null)
    or (intervention_id is null and contract_id is not null and report_month is not null)
  );

-- Format YYYY-MM strict pour report_month (cohérent avec parseMonthParam helper).
alter table public.proof_share_tokens
  add constraint chk_report_month_format check (
    report_month is null or report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  );

-- Index partial pour lookup rapide "tokens actifs d'un rapport mensuel donné"
-- (page contrat / révocation côté admin).
create index idx_share_tokens_contract_month
  on public.proof_share_tokens(contract_id, report_month)
  where contract_id is not null and revoked_at is null;

comment on column public.proof_share_tokens.contract_id is
  'Contract référencé pour le cas rapport mensuel. NULL si dossier de preuves intervention. ON DELETE CASCADE.';

comment on column public.proof_share_tokens.report_month is
  'Format YYYY-MM. Si non null, ce token correspond à un rapport mensuel client (Chantier E).';

comment on column public.proof_share_tokens.selected_photo_ids is
  'Sélection figée des photos approuvées par le DG (1..12 ids). Renvoie une vue cohérente quel que soit le moment où le client clique sur le lien.';

comment on column public.proof_share_tokens.dg_note is
  'Note libre du DG, figée au moment de l''approbation. Max 300 chars (cap applicatif).';

comment on constraint chk_token_kind on public.proof_share_tokens is
  'XOR strict : soit dossier de preuves (intervention_id seul) soit rapport mensuel (contract_id + report_month).';
