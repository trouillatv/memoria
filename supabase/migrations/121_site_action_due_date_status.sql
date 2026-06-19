-- =============================================================================
-- 121 — Sprint 2 : qualité de l'échéance d'une action.
--
-- Une échéance peut être : explicite (date dite en réunion), estimée (date
-- relative « la semaine prochaine » résolue par l'IA → À CONFIRMER), ou absente.
-- `due_date` portait déjà la valeur ; on ajoute son STATUT pour que le badge
-- « à confirmer » survive à la création et s'affiche dans le PV / la liste /
-- les exports. NULL = pas d'échéance OU échéance saisie manuellement sans label.
--
-- Doctrine : l'IA PROPOSE (estimated), l'humain CONFIRME (→ explicit) ou retire.
-- Jamais d'invention : pas de date dite ⇒ due_date NULL, due_date_status NULL.
-- =============================================================================

alter table public.site_actions
  add column if not exists due_date_status text
    check (due_date_status in ('explicit', 'estimated'));
