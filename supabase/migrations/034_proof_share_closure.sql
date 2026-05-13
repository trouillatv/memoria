-- Sprint 6 — Fermeture mentale (doctrine V5 verrou V3)
-- "Clôturé" pas "résolu". Juridiquement safe.
--
-- Permet à Patrick (DG cleaning) de fermer mentalement un dossier de preuves
-- partagé une fois l'échange client apaisé. Le dossier reste consultable,
-- mais l'UI signale clairement la phase de clôture (passive, descriptive).
--
-- Verrou doctrinal V3 : dans le cleaning, les problèmes ne sont presque
-- jamais résolus définitivement. "Résolu" implique acceptation de
-- responsabilité — juridiquement dangereux. On choisit "clôturé" :
--   ✅ « Dossier clôturé · Incident traité · Réclamation refermée »
--   ❌ « Problème résolu · Issue closed »

alter table public.proof_share_tokens
  add column closed_at timestamptz,
  add column closed_by uuid references public.users(id) on delete set null,
  add column closure_note text;

-- Index partiel pour le widget cockpit ("N dossiers clôturés ce mois")
-- et tout filtre futur sur la clôture. Pas d'index sur closed_by
-- (cohérent avec la doctrine V3 anti reverse-lookup user).
create index idx_proof_share_tokens_closed
  on public.proof_share_tokens(closed_at)
  where closed_at is not null;

-- Cap applicatif sur la note libre (200 chars) — pas de mini-CMS.
-- La contrainte DB est plus large (255) pour laisser un peu d'air
-- en cas d'évolution applicative.
alter table public.proof_share_tokens
  add constraint chk_proof_share_closure_note_length
    check (closure_note is null or char_length(closure_note) <= 255);

comment on column public.proof_share_tokens.closed_at is
  'Doctrine V5 verrou V3 : "clôturé", JAMAIS "résolu". Pas d''acceptation de responsabilité.';
comment on column public.proof_share_tokens.closed_by is
  'Utilisateur ayant clôturé le dossier (manager+). NULL si rouvert.';
comment on column public.proof_share_tokens.closure_note is
  'Note libre 0..200 chars (cap applicatif). Ex : "Échange finalisé après réunion du 15 mai".';
