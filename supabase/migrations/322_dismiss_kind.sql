-- 322 — POURQUOI ÉCARTER (taxonomie validée Vincent 2026-08-14).
--
-- `dismiss_reason` (texte libre, mig 212) ne permet pas à MemorIA de
-- distinguer trois informations radicalement différentes pour la mémoire :
--   « l'IA s'est trompée, c'est faux »       → false_extraction
--   « c'est vrai mais sans intérêt métier »  → not_relevant
--   « on l'a déjà »                          → duplicate
--
-- VOLONTAIREMENT ABSENT : 'obsolete'. L'obsolescence est une ÉVOLUTION DU
-- MONDE, pas une erreur de proposition — elle passe par superseded
-- (migs 215/319), jamais par l'écart. Sans cette taxonomie, les arbitrages
-- humains apprennent de travers.
--
-- Additif : colonne nullable, dismiss_reason (libre) reste en complément.

alter table public.site_knowledge_proposals
  add column if not exists dismiss_kind text
    check (dismiss_kind in ('false_extraction', 'not_relevant', 'duplicate'));

comment on column public.site_knowledge_proposals.dismiss_kind is
  'Sémantique fermée de l''écart : false_extraction (faux) · not_relevant (vrai mais sans objet) · duplicate (déjà connu). L''obsolescence n''est PAS un écart (superseded).';
