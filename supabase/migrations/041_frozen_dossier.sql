-- Migration 041 — Freeze immuable du PDF à la clôture.
--
-- Phase 1.2 du plan « mémoire défendable ». Quand un dossier de preuves est
-- clôturé, on génère le PDF une fois, on calcule son SHA-256, on le stocke
-- dans un bucket privé immuable. Toute consultation ultérieure sert ce PDF
-- figé — jamais de regénération qui pourrait diverger.
--
-- Pourquoi : un PDF généré on-demand peut différer selon les données qui ont
-- évolué entre la clôture et la consultation. Pour une preuve juridique, le
-- document doit être figé au moment T, vérifiable bit-à-bit ad vitam.
--
-- Scope MVP : limité aux dossiers de preuves (intervention_id non null).
-- Les rapports mensuels pourront être traités plus tard si besoin.

alter table public.proof_share_tokens
  add column if not exists frozen_pdf_path text,
  add column if not exists frozen_pdf_sha256 text,
  add column if not exists frozen_at timestamptz;

comment on column public.proof_share_tokens.frozen_pdf_path is
  'Chemin du PDF figé dans le bucket frozen-dossiers. Non null = dossier clôturé et figé.';
comment on column public.proof_share_tokens.frozen_pdf_sha256 is
  'SHA-256 du PDF figé. Permet de vérifier l''intégrité du fichier servi.';
comment on column public.proof_share_tokens.frozen_at is
  'Date de gel du PDF (peut différer légèrement de closed_at).';

-- Bucket privé pour les PDF figés. Service role uniquement, pas d'accès direct.
insert into storage.buckets (id, name, public) values
  ('frozen-dossiers', 'frozen-dossiers', false)
on conflict (id) do nothing;

-- Pas de policy SELECT en mode authenticated : seul le service role (côté
-- routes serveur) télécharge ces PDF pour les servir avec validation token.
-- Cette politique est intentionnellement absente.
