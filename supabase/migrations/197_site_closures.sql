-- 197 — Fermetures de site (PL2, décision Vincent 2026-07-13)
--
-- Une FERMETURE = « ce lieu est fermé du X au Y ». C'est une donnée de LIEU,
-- jamais d'humain : ni congé, ni absence, ni disponibilité de personne
-- (cf. [[refus-erp-rh-pointage-gps]] et la ligne rouge du planning par personne,
-- audit/10-planning-pl0.md).
--
-- DOCTRINE PL2 — ce que cette table NE fait PAS :
--  - elle ne déplace RIEN : aucune intervention, aucun rythme n'est touché ;
--  - elle ne décide RIEN : une fermeture + une prestation prévue = un CONFLIT
--    que PL3 SIGNALERA, et que l'humain tranchera (déplacer avant/après,
--    maintenir, annuler). Aucun déplacement automatique, jamais.
--
-- Le « jour férié » n'est PAS un type de fermeture : un férié n'est pas une
-- fermeture (magasin A fermé, B ouvert, C de permanence). Le FAIT métier est
-- « le site est fermé » ; le férié n'en est que la RAISON. D'où `reason_kind`.
--
-- `default_resolution` est posé DÈS MAINTENANT mais n'est utilisé par AUCUN
-- code de PL2 : il permettra à PL3 de proposer un geste par défaut sans exiger
-- une nouvelle migration.
--
-- Pas de `organization_id` (décision Vincent) : le site porte déjà
-- l'organisation. Le dupliquer ferait diverger les deux valeurs un jour. La
-- garde d'appartenance passe donc par le SITE parent (lib/auth/ownership.ts,
-- `requireOwned(role, 'sites', siteId)`).
--
-- ON DELETE CASCADE sur site_id : aligné sur site_blocages (160:24) et
-- visit_watchlist_item (196:23). En pratique il ne se déclenche jamais — les
-- sites sont RETIRÉS (softDeleteSite, sites.ts:440), jamais supprimés.
--
-- Idempotente (rejouée par .github/workflows/db-reproducibility.yml).
-- Rollback : DROP TABLE. Aucune donnée existante impactée.

create table if not exists public.site_closures (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id) on delete cascade,

  -- La RAISON de la fermeture (le fait, lui, est toujours « fermé »).
  reason_kind      text not null default 'other' check (reason_kind in (
                     'holiday',      -- jour férié
                     'client',       -- fermeture décidée par le client
                     'maintenance',  -- travaux, entretien du lieu
                     'inventory',    -- inventaire
                     'exceptional',  -- fermeture exceptionnelle
                     'other'
                   )),
  -- Motif libre (« Magasin fermé », « Fermeture annuelle du client »).
  reason           text check (reason is null or length(reason) <= 500),

  -- Une fermeture est une PÉRIODE. Un seul jour → starts_on = ends_on.
  starts_on        date not null,
  ends_on          date not null,

  -- PL3 : geste proposé par défaut face à une prestation prévue ce jour-là.
  -- Écrit dès PL2, LU par personne avant PL3.
  default_resolution text not null default 'none' check (default_resolution in (
                     'none', 'move', 'cancel', 'keep'
                   )),

  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  -- Une fermeture se corrige (dates, motif) : on trace QUI, pas seulement QUAND.
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  -- Retrait LOGIQUE (doctrine « Retirer », audit/03). `deleted_at` seul :
  -- `deleted_by` n'existe nulle part dans le schéma, on n'invente pas.
  deleted_at       timestamptz,

  constraint site_closures_dates_chk check (ends_on >= starts_on)
);

-- Index partiel : les lectures ne regardent QUE les fermetures actives.
create index if not exists site_closures_site_idx
  on public.site_closures (site_id, starts_on desc)
  where deleted_at is null;

alter table public.site_closures enable row level security;

-- Lecture : sites de l'organisation de l'utilisateur.
-- Écriture : service-role (Server Actions) — aucune policy write, comme
-- site_decisions (136), site_blocages (160), visit_capture (165).
drop policy if exists "site_closures read" on public.site_closures;
create policy "site_closures read" on public.site_closures
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

comment on table public.site_closures is
  'Fermetures d''un site (mig 197, PL2) — « ce lieu est fermé du X au Y ». Donnée de LIEU, jamais d''humain. Ne déplace ni n''annule rien : PL3 signalera le conflit, l''humain tranchera. reason_kind = la RAISON (un férié n''est pas une fermeture en soi). default_resolution : posé pour PL3, non lu en PL2.';
