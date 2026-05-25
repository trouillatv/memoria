-- Migration 085 — intervention_templates : heure précise (Vincent 2026-05-26)
--
-- Résout l'incohérence : la récurrence ne portait qu'un créneau (matin/après-midi
-- /soir), pas une heure précise. On ajoute planned_start_hhmm / planned_end_hhmm
-- (format 'HH:MM') pour que chaque intervention générée naisse avec l'heure
-- exacte. Le créneau (slot) reste dérivé de l'heure (placement grille + index
-- d'unicité). NULL = ancien comportement (ancrage par créneau).

alter table public.intervention_templates
  add column if not exists planned_start_hhmm text,
  add column if not exists planned_end_hhmm text;

comment on column public.intervention_templates.planned_start_hhmm is
  'Heure de début HH:MM de chaque occurrence générée. NULL = ancrage créneau. Vincent 2026-05-26.';
comment on column public.intervention_templates.planned_end_hhmm is
  'Heure de fin HH:MM de chaque occurrence générée. Vincent 2026-05-26.';
