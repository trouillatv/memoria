-- Migration 209 — Un appel d'offres est une BIBLIOTHÈQUE de pièces, jamais un document.
--
-- Enseignement terrain (Guillaume, session 2026-07-13) : « un AO n'est jamais un
-- document ». C'est un dossier — RC, CCAP, CCTP, DPGF, BPU, plans, annexes — et
-- les pièces se répondent : le CCTP décrit ce que le CCAP engage, le BPU chiffre
-- ce que le CCTP décrit. Lire une seule pièce, c'est lire le dossier de travers.
--
-- Le schéma portait DÉJÀ N documents par AO (tender_documents.tender_id, mig 005)
-- et le produit n'en exploitait qu'un (getTenderDocument → limit 1). Ce qui
-- manquait n'est pas la place : c'est la NATURE de la pièce, sans laquelle on ne
-- peut ni la nommer à l'écran, ni la citer dans une analyse, ni savoir ce qui
-- manque au dossier.
--
-- Additive, idempotente, non destructive : colonne NULLABLE, aucune donnée
-- existante touchée. Les AO à un seul document restent valides (kind = null =
-- « pièce non qualifiée »). Rollback : DROP COLUMN.

alter table public.tender_documents
  add column if not exists kind text
    check (kind is null or kind in ('rc', 'ccap', 'cctp', 'dpgf', 'bpu', 'plan', 'annexe', 'autre'));

comment on column public.tender_documents.kind is
  'Nature de la pièce du dossier AO (rc, ccap, cctp, dpgf, bpu, plan, annexe, autre). '
  'NULL = pièce non qualifiée : AO antérieur à la bibliothèque, ou nature non déduite '
  'du nom de fichier. Déduction : lib/tenders/pieces.ts (déterministe, zéro IA), '
  'toujours corrigeable par l''utilisateur — le logiciel propose, il n''affirme pas.';

create index if not exists tender_documents_tender_kind_idx
  on public.tender_documents (tender_id, kind);
