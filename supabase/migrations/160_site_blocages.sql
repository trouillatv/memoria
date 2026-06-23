-- 160 — Blocages de chantier (Vincent 2026-06-24)
--
-- Un BLOCAGE = un événement daté qui empêche d'avancer : intempérie, grève,
-- accès, livraison, matériel, sous-traitant, administratif, sécurité, autre.
-- C'est de la MÉMOIRE DE CONTEXTE opposable — PAS du planning, PAS un Gantt.
--
-- DOCTRINE (cf. [[gouvernance-4-concepts-anti-erp]], [[refus-erp-rh-pointage-gps]]) :
--  - Concept « Événement » de la gouvernance anti-ERP — PAS un nouveau pilier.
--  - Descriptif, niveau SITE, jamais une mesure d'humain : aucun score, aucune
--    imputation de retard, aucun %. Le blocage décrit un fait, il ne juge personne.
--  - La météo NE décide PAS seule (cf. [[litige-no-automatic-reading]]) : un
--    blocage météo POINTE vers site_day_log (day_log_id), il ne recopie pas la
--    météo. Une seule source météo (mig 108) — pas de weather_snapshot dupliqué.
--  - Timeline = PROJECTION : ces lignes sont LUES par getSiteMemoryTimeline,
--    jamais une table-poubelle qui duplique interventions/actions/réserves
--    (cf. [[surfaces-memoire-1source-nsurfaces]]).
--
-- Calqué sur site_decisions (mig 136). subject_id dès maintenant : le blocage
-- s'accroche au Sujet, « Raconte-moi ce chantier » devient gratuit plus tard.

create table if not exists public.site_blocages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid,
  site_id          uuid not null references public.sites(id) on delete cascade,
  subject_id       uuid references public.subjects(id) on delete set null,
  type             text not null check (type in (
                     'intemperie', 'greve', 'acces', 'livraison',
                     'materiel', 'sous_traitant', 'administratif', 'securite', 'autre'
                   )),
  title            text not null check (length(title) between 1 and 200),
  description      text check (description is null or length(description) <= 2000),
  impact           text check (impact is null or length(impact) <= 600),
  date_start       date not null default current_date,
  date_end         date,                                   -- null = blocage encore en cours
  -- 'human' (saisie manuelle) | 'meeting' (créé depuis un CR) | 'detected' (proposé par détection PV, validé par l'humain)
  source_type      text not null default 'human' check (source_type in ('human', 'meeting', 'detected')),
  source_report_id uuid references public.site_reports(id) on delete set null,
  -- Lien météo : POINTE vers site_day_log, ne recopie jamais la météo.
  day_log_id       uuid references public.site_day_log(id) on delete set null,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint site_blocages_dates_chk check (date_end is null or date_end >= date_start)
);

create index if not exists site_blocages_site_idx
  on public.site_blocages (site_id, date_start desc);
create index if not exists site_blocages_report_idx
  on public.site_blocages (source_report_id) where source_report_id is not null;
create index if not exists site_blocages_subject_idx
  on public.site_blocages (subject_id) where subject_id is not null;

alter table public.site_blocages enable row level security;

-- Lecture : sites de l'org de l'utilisateur. Écriture : service-role (Server Actions).
create policy "site_blocages read" on public.site_blocages
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

comment on table public.site_blocages is
  'Blocages de chantier (mig 160, Vincent 2026-06-24). Mémoire de contexte datée et opposable (intempérie/grève/accès/livraison/matériel/sous-traitant/administratif/sécurité). Descriptif niveau SITE, jamais une mesure d''humain : aucun score/%/imputation. Blocage météo POINTE vers site_day_log (day_log_id), ne recopie pas. Timeline = projection (lecture), pas une table-poubelle. RLS read par org ; écriture service-role.';
