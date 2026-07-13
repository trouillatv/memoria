-- Migration 203 — LE CALENDRIER SCOLAIRE.
--
-- Guillaume nettoie des écoles. Pendant les vacances, elles sont fermées — et
-- il le sait bien avant que le planning ne le sache. Aujourd'hui il doit
-- déclarer la même fermeture, à la main, sur chaque école. Six écoles × cinq
-- périodes = trente saisies identiques, chaque année.
--
-- Or ce n'est PAS un fait de chantier : c'est un fait d'ORGANISATION. Les mêmes
-- dates valent pour tous les établissements. D'où un objet à part.
--
-- ⚠️ AUCUNE DATE N'EST INVENTÉE ICI. Le calendrier scolaire calédonien change
-- chaque année et n'est pas déductible : c'est l'utilisateur qui saisit les
-- périodes officielles, une fois. Livrer un calendrier codé en dur serait
-- inventer de la donnée — et une fermeture fausse est pire qu'une absence de
-- fermeture : elle déplacerait du vrai travail.
--
-- Le calendrier ne crée pas un second mécanisme de fermeture : il PRODUIT des
-- `site_closures` ordinaires. Toute la chaîne déjà construite (la vue Semaine,
-- l'aperçu du roulement, les conflits, le tableau de bord) les voit sans une
-- ligne de code de plus. Une seule vérité.
--
-- Les fermetures ainsi dérivées portent `calendar_period_id` : c'est ce qui
-- permet de les régénérer proprement — et de ne JAMAIS les laisser modifier à la
-- main (même doctrine que les rythmes d'un roulement : la source est le
-- calendrier, pas la copie).
--
-- Idempotente. Rollback : DROP TABLE + DROP COLUMN. Aucune donnée existante
-- impactée (les fermetures saisies à la main gardent `calendar_period_id` NULL).

create table if not exists public.school_calendar_period (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,

  -- « Vacances de juillet », « Rentrée », « Fêtes de fin d'année »…
  label            text not null check (length(label) between 1 and 120),

  -- Une période, jamais un jour isolé (un jour = starts_on = ends_on).
  starts_on        date not null,
  ends_on          date not null,

  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  -- Retrait LOGIQUE (doctrine « Retirer ») : `deleted_at` seul.
  deleted_at       timestamptz,

  constraint school_calendar_period_dates_chk check (ends_on >= starts_on)
);

create index if not exists school_calendar_period_org_idx
  on public.school_calendar_period (organization_id, starts_on)
  where deleted_at is null;

-- Le chantier SUIT-IL le calendrier ? Explicite, jamais déduit : toutes les
-- écoles ne sont pas des écoles, et un magasin ne ferme pas aux vacances.
alter table public.sites
  add column if not exists follows_school_calendar boolean not null default false;

-- La fermeture DÉRIVÉE pointe sa source. NULL = fermeture saisie à la main
-- (elle, reste librement modifiable).
alter table public.site_closures
  add column if not exists calendar_period_id uuid
    references public.school_calendar_period(id) on delete set null;

create index if not exists site_closures_calendar_idx
  on public.site_closures (calendar_period_id)
  where calendar_period_id is not null;

comment on column public.site_closures.calendar_period_id is
  'Période du calendrier scolaire dont cette fermeture dérive. NULL = fermeture saisie à la main. Une fermeture dérivée n''est jamais modifiable à la main : on régénère depuis le calendrier.';
