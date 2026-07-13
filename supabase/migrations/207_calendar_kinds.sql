-- Migration 207 — Les JOURS FÉRIÉS rejoignent les calendriers communs.
--
-- Arbitrage Vincent (2026-07-15) : le domaine Planning regroupe Semaine,
-- Roulements et FERMETURES. La page Fermetures distingue :
--
--   1. les CALENDRIERS COMMUNS de l'organisation — vacances scolaires ET jours
--      fériés : des sources de dates partagées, saisies une fois ;
--   2. leur ACTIVATION PAR CHANTIER — un jour férié ne ferme PAS tous les
--      sites : le magasin ouvre peut-être le 14 juillet, l'école jamais.
--      L'adhésion est un choix explicite, par chantier, par calendrier ;
--   3. les fermetures réelles qui en découlent (site_closures, inchangées).
--
-- Même mécanique que le scolaire (mig 203) : AUCUNE date codée en dur — les
-- fériés calédoniens sont saisis par l'utilisateur. Une fermeture fausse est
-- pire qu'une absence de fermeture : elle déplacerait du vrai travail.
--
-- Additive, idempotente. Rollback : DROP COLUMN ×2. Les périodes existantes
-- deviennent 'scolaire' (elles le sont toutes).

alter table public.school_calendar_period
  add column if not exists kind text not null default 'scolaire'
    check (kind in ('scolaire', 'ferie'));

create index if not exists school_calendar_period_kind_idx
  on public.school_calendar_period (organization_id, kind, starts_on)
  where deleted_at is null;

-- L'adhésion aux fériés est SÉPARÉE de l'adhésion au scolaire : deux réalités
-- différentes (une école suit les deux, un magasin peut-être aucun).
alter table public.sites
  add column if not exists follows_public_holidays boolean not null default false;
