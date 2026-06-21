-- Lien obligation ↔ document (Vincent 2026-06-21). « Brancher PAQ/CCTP à la
-- bibliothèque » = RATTACHER le document source à l'obligation, PAS le parser.
--   Obligation « Essais à la plaque » → document « CCTP VRD » + référence libre
--   « Chapitre 4.2 / page 18 ».
--
-- Doctrine (refus explicite) : aucun parsing CCTP, aucun embedding, aucune
-- suggestion automatique de clause, aucune extraction IA. Le document est
-- rattaché à l'obligation ; MemorIA ne prétend pas comprendre tout le CCTP.

-- 1) Autoriser target_type = 'obligation' (patron des mig 123/124).
alter table public.document_links drop constraint if exists document_links_target_type_check;
alter table public.document_links add constraint document_links_target_type_check
  check (target_type in (
    'contract','site','tender','client','intervention','team','tenant','reserve','subject','obligation'));

-- 2) Référence libre (chapitre / article / page) — saisie humaine, jamais dérivée.
alter table public.document_links
  add column if not exists reference_label text;

comment on column public.document_links.reference_label is
  'Référence libre saisie à la main (ex. « CCTP chapitre 4.2 / page 18 ») pour un lien obligation↔document. NULL = aucune. Jamais extraite par IA.';
