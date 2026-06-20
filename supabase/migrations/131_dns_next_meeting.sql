-- =============================================================================
-- 131 — STOCKAGE du N° DNS du chantier et de la DATE de prochaine réunion
-- (Vincent 2026-06-21, en test). Ces deux bloquants « documentaires » n'avaient
-- nulle part où être écrits → l'écran proposait Reporter/Ignorer mais pas
-- « Compléter ». On ajoute les colonnes → ils deviennent remplissables (resolver
-- écrit la source ; une seule vérité).
-- =============================================================================

-- N° DNS : propre au chantier (réutilisé dans tous ses CR).
alter table public.sites add column if not exists dns text;

-- Date de prochaine réunion : propre à CE compte-rendu.
alter table public.site_reports add column if not exists next_meeting_at date;
