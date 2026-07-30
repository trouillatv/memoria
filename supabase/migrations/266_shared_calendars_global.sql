-- Migration 226 — LES CALENDRIERS COMMUNS DEVIENNENT GLOBAUX (multitenants).
--
-- Décision Vincent (2026-07-21) : les jours fériés et le calendrier scolaire
-- ne sont pas un fait d'organisation — ce sont les MÊMES dates pour tous les
-- tenants calédoniens. Les saisir dans chaque organisation dupliquait la même
-- vérité, avec le risque de la voir diverger.
--
--   • `organization_id` devient NULLABLE : NULL = période GLOBALE, visible par
--     toutes les organisations.
--   • Les périodes existantes (aujourd'hui : uniquement l'import officiel
--     NC 2026 du tenant AGP, vérifié en base le 2026-07-21) sont promues
--     globales, après dédoublonnage (kind, label, dates) au cas où plusieurs
--     tenants auraient importé les mêmes dates.
--   • L'écriture est désormais réservée à la plateforme (admin ou
--     vincent.trouillat@memoria.nc) — gardée dans le code applicatif, comme
--     toutes les server actions (service role, doctrine fail-closed).
--   • Les jours fermés SUPPLÉMENTAIRES restent des `site_closures` saisies
--     depuis la fiche d'un chantier — rien ne change pour eux.
--
-- Idempotente. Rollback : re-poser NOT NULL après avoir réaffecté un
-- organization_id aux lignes globales. Aucune suppression physique : les
-- doublons éventuels sont retirés LOGIQUEMENT (deleted_at) après remappage de
-- leurs fermetures dérivées.

alter table public.school_calendar_period
  alter column organization_id drop not null;

comment on column public.school_calendar_period.organization_id is
  'NULL = période GLOBALE (multitenant), gérée par la plateforme. Depuis la mig 226, toutes les périodes vivantes sont globales ; une valeur non nulle ne subsiste que sur d''anciennes lignes retirées (deleted_at).';

-- 1. Dédoublonnage : si plusieurs organisations avaient saisi la même période
--    (même type, même libellé, mêmes dates), on garde la plus ancienne.
--    Les fermetures dérivées des doublons sont remappées sur la survivante.
with ranked as (
  select id,
         first_value(id) over w as keeper,
         row_number() over w as rn
  from public.school_calendar_period
  where deleted_at is null
  window w as (
    partition by kind, label, starts_on, ends_on
    order by created_at, id
  )
)
update public.site_closures sc
set calendar_period_id = r.keeper
from ranked r
where sc.calendar_period_id = r.id
  and r.rn > 1;

with ranked as (
  select id,
         row_number() over (
           partition by kind, label, starts_on, ends_on
           order by created_at, id
         ) as rn
  from public.school_calendar_period
  where deleted_at is null
)
update public.school_calendar_period p
set deleted_at = now()
from ranked r
where p.id = r.id
  and r.rn > 1;

-- 2. Promotion : toute période vivante devient globale.
update public.school_calendar_period
set organization_id = null
where deleted_at is null
  and organization_id is not null;
