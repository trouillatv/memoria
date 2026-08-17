-- 335_visit_capture_included_in_cr.sql
-- Sélection éditoriale du CR (Vincent, 2026-08-17) : la qualification métier
-- (triage_intent) ne doit plus décider, même indirectement, de la présence
-- d'une photo dans le compte-rendu. `included_in_cr` porte CETTE décision,
-- séparée : toute capture gardée y entre par défaut (true), l'utilisateur peut
-- l'en retirer explicitement à l'écran du CR — sans jamais toucher triage_intent
-- ni son statut kept/discarded (la mémoire de MemorIA).
alter table visit_capture
  add column if not exists included_in_cr boolean not null default true;
