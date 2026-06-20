-- =============================================================================
-- 135 — Prévisions STRUCTURÉES + modèle ORGANISME prêt (Vincent 2026-06-21).
--
-- (a) Prévisions : la fiabilité est une DONNÉE, pas un détail. Une prévision saisie
--     en séance porte sa confiance ('sûr' | 'à confirmer'). Socle des futurs
--     « préparer la réunion / détecter les retards / comparer prévu-réalisé ».
--
-- (b) Colonne ACTION : le vrai responsable n'est pas le RÔLE (ETV) mais l'ORGANISME
--     (BatiSud). On prépare déjà le modèle — colonne `organisations[]` à côté de
--     `codes[]` — même si l'UI n'affiche encore que les rôles. Aucune rupture future.
-- =============================================================================

alter table public.report_added_points
  add column if not exists confiance text;   -- 'sûr' | 'à confirmer' ; null ⇒ 'sûr'

alter table public.report_point_actions
  add column if not exists organisations text[] not null default '{}'; -- noms d'organismes (ETV=BatiSud…)
