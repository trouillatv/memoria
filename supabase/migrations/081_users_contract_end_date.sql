-- ===========================================================
-- Migration 081 — users.contract_end_date (Vincent 2026-05-22)
--
-- Sprint E — Continuité de mémoire anticipée.
--
-- Pré-requis pour anticiper la perte de mémoire opérationnelle quand un
-- contrat de travail se termine (CDD, CDI Chantier). On ne stocke PAS de
-- détails RH — juste la DATE pour permettre à MemorIA d'avertir que des
-- sites portent une mémoire qui pourrait disparaître.
--
-- Doctrine V6.8 et [[doctrine-rh]] :
--   - Le sujet de la transition est la MÉMOIRE OPÉRATIONNELLE, jamais
--     la valeur ou la performance de la personne.
--   - Aucun calcul prédictif "risque de départ".
--   - Garde-fous CI : forbidden-symbols.test.ts étendu (Sprint E).
--   - Page /continuite gated par CONTINUITY_PAGE_ENABLED.
--   - Audit log de chaque consultation.
--   - Self-exclu : une personne ne voit pas sa propre fin de contrat.
--
-- IDEMPOTENT.
-- ===========================================================

alter table public.users
  add column if not exists contract_end_date date;

comment on column public.users.contract_end_date is
  'Vincent 2026-05-22 — Date de fin de contrat de travail (NULL pour CDI permanent ou non renseigné). Sert UNIQUEMENT à anticiper la passation de la mémoire opérationnelle portée par cette personne. Pas de notation, pas de prédiction de départ, pas de RH. Doctrine [[doctrine-rh]] verrouille l''usage.';

-- Index partiel pour requêter rapidement "contrats finissant dans les X jours"
create index if not exists idx_users_contract_end_active
  on public.users(contract_end_date)
  where deleted_at is null and contract_end_date is not null;
