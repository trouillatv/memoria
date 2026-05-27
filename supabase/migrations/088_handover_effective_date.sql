-- Migration 088 — Date d'effet d'un passage de témoin (Vincent 2026-05-27).
--
-- « À partir de quand le témoin est effectif » : la date à laquelle la personne
-- (ou l'équipe) est remplacée. Optionnelle (un brief peut être préparé sans
-- date arrêtée). Additif, non destructif.

ALTER TABLE public.handover_briefs
  ADD COLUMN IF NOT EXISTS effective_date date;

COMMENT ON COLUMN public.handover_briefs.effective_date IS
  'Date à partir de laquelle le passage de témoin devient effectif (remplacement). NULL si non arrêtée.';
