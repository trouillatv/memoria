-- 163 — Captures de visite + routage multi-destination (Vincent 2026-06-27)
--
-- Une VISITE a TROIS temps, aux contraintes incompatibles (cf. [[visite-trois-temps]]) :
--   1. TERRAIN   — on collecte sans réfléchir (statut 'captured'). L'IA se tait.
--   2. VOITURE   — débrief express, 2 min : garder / écarter / compléter
--                  (statut 'kept' | 'discarded'). Pas de décision métier.
--   3. BUREAU    — débrief complet : l'IA a préparé en tâche de fond (ai_prepared),
--                  l'humain route vers N destinations (statut 'processed').
--
-- L'ATOME : visit_capture = la matière première BRUTE (photo/vocal/note/
-- vérification/position). Invisible au métier — le mot « observation » n'apparaît
-- JAMAIS dans l'UX. C'est ce qui ARRIVE pendant la visite, AVANT de devenir un
-- objet métier.
--
-- RÉCONCILIATION avec la doctrine « lentille » de mig 162 : la visite reste une
-- LENTILLE, pas un conteneur. La capture ne CONTIENT pas l'action/réserve — elle
-- la PRÉCÈDE. Au bureau, le ROUTAGE MATÉRIALISE les objets métier (action,
-- réserve, sujet…) qui, eux, s'attachent au SITE (lentille). visit_capture_routes
-- garde la trace « cette capture a nourri tel objet ».
--
-- MULTI-DESTINATION (essentiel) : une photo ou un vocal peut nourrir PLUSIEURS
-- sorties (journal ET point suivi ET compte-rendu). On ne force JAMAIS une capture
-- à devenir un seul objet : capture brute → plusieurs destinations possibles.
--
-- L'IA PROPOSE, L'HUMAIN DÉCIDE (cf. [[memoire-assistee]], [[ai-cost-discipline]]) :
-- la préparation IA (rapprochement au point suivi + destinations probables) est
-- pré-calculée en ASYNC entre la voiture et le bureau et stockée dans
-- `ai_prepared` (jsonb). Les ROUTES, elles, ne contiennent que ce que l'humain a
-- VALIDÉ. Aucun LLM live au moment du tri.
--
-- INVARIANT suppression (cf. [[pv-reconstruction-manuelle]]) : 'discarded' est un
-- état RÉVERSIBLE (artefact terrain écarté), jamais un DELETE. La capture brute
-- n'est pas perdue.
--
-- INVARIANT anti-RH : une capture qualifie un LIEU / un OUVRAGE / un SUJET,
-- jamais une personne ni une entreprise (cf. [[refus-erp-rh-pointage-gps]]).

-- ── L'atome brut ─────────────────────────────────────────────────────────────

create table if not exists public.visit_capture (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid,
  site_id          uuid not null references public.sites(id) on delete cascade,
  -- La visite (un site_report avec origin non-null, mig 162). La capture appartient
  -- à la visite (≠ lentille) : c'est l'INBOX brute, supprimée si la visite l'est.
  report_id        uuid not null references public.site_reports(id) on delete cascade,
  -- Les 4 gestes + position. 'verification' = « j'ai recontrôlé un point suivi ».
  kind             text not null check (kind in (
                     'photo', 'vocal', 'note', 'verification', 'position'
                   )),
  -- Cycle de vie = les 3 temps de la visite.
  status           text not null default 'captured' check (status in (
                     'captured',   -- 1. terrain
                     'kept',        -- 2. voiture : gardé
                     'discarded',   -- 2. voiture : écarté (réversible, jamais DELETE)
                     'processed'    -- 3. bureau : routé vers ≥1 destination
                   )),
  -- Contenu texte : note saisie, ou transcription d'un vocal (remplie en async).
  body             text check (body is null or length(body) <= 8000),
  -- Vocal : suivi de la transcription (l'IA travaille en tâche de fond).
  transcript_status text check (transcript_status is null or transcript_status in (
                     'pending', 'done', 'failed'
                   )),
  -- Photo / vocal : la pièce jointe (réutilise site_report_attachments).
  attachment_id    uuid references public.site_report_attachments(id) on delete set null,
  -- 'verification' : le point suivi recontrôlé. Sinon : le sujet concerné si déjà connu.
  subject_id       uuid references public.subjects(id) on delete set null,
  -- Préparation IA pré-calculée en ASYNC (entre voiture et bureau). L'IA PROPOSE.
  -- Forme libre : { subject_id?, subject_confidence?, destinations?: [...], summary? }.
  ai_prepared      jsonb,
  -- 'position' : capté one-shot, opt-in (cf. [[ouverture-contextuelle-gps]]).
  lat              double precision,
  lng              double precision,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Timeline de la visite (terrain) + tri (voiture/bureau) : par report, par statut.
create index if not exists visit_capture_report_idx
  on public.visit_capture (report_id, created_at);
create index if not exists visit_capture_site_status_idx
  on public.visit_capture (site_id, status);
create index if not exists visit_capture_subject_idx
  on public.visit_capture (subject_id) where subject_id is not null;

alter table public.visit_capture enable row level security;

-- Lecture : sites de l'org. Écriture : service-role (Server Actions).
drop policy if exists "visit_capture read" on public.visit_capture;
create policy "visit_capture read" on public.visit_capture
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

comment on table public.visit_capture is
  'Captures brutes de visite (mig 163, Vincent 2026-06-27). Atome invisible au métier (le mot « observation » n''apparaît jamais dans l''UX). 4 gestes + position. Cycle = les 3 temps : captured (terrain) → kept|discarded (voiture, débrief express) → processed (bureau, débrief complet). ai_prepared = proposition IA pré-calculée en async (l''IA propose, l''humain décide). discarded RÉVERSIBLE jamais DELETE. Qualifie un lieu/ouvrage/sujet, jamais une personne. RLS read par org ; écriture service-role.';

-- ── Le routage multi-destination ─────────────────────────────────────────────

create table if not exists public.visit_capture_routes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid,
  capture_id       uuid not null references public.visit_capture(id) on delete cascade,
  -- Où la capture a été classée. Une capture → PLUSIEURS lignes (multi-destination).
  --
  -- DEUX NATURES de route, à NE PAS confondre (réserve Vincent 2026-06-27) :
  --
  --  • route MATÉRIELLE — crée ou rattache un OBJET RÉEL. target_id est RENSEIGNÉ
  --    (et target_table dit lequel) : 'action', 'reserve', 'anomalie', 'subject',
  --    'document'.
  --  • route de PROJECTION — la capture APPARAÎT seulement dans une vue dérivée, il
  --    n'y a aucun objet à pointer. target_id est NULL : 'journal', 'compte_rendu'.
  --    Ne JAMAIS chercher un target_id ici — il n'existe pas par construction.
  destination      text not null check (destination in (
                     -- ↓ projection (target_id NULL)
                     'journal',       -- apparaît dans le Journal du chantier
                     'compte_rendu',  -- apparaît dans le CR de visite
                     -- ↓ matérielle (target_id renseigné)
                     'action',        -- crée / alimente une action
                     'reserve',       -- crée / alimente une réserve
                     'anomalie',      -- crée une anomalie
                     'subject',       -- « Suivre ce point » (rattache à un sujet)
                     'document'       -- crée un document
                   )),
  -- L'objet MATÉRIALISÉ par le routage (action_id, reserve_id, subject_id…).
  -- RENSEIGNÉ pour une route matérielle, NULL pour une route de projection.
  target_id        uuid,
  -- Quelle table target_id pointe ('site_actions', 'site_reserve', 'subjects'…).
  target_table     text,
  -- Cohérence des deux natures : projection ⇒ target_id NULL ; matérielle ⇒ renseigné.
  constraint visit_capture_routes_nature_chk check (
    (destination in ('journal', 'compte_rendu') and target_id is null)
    or (destination in ('action', 'reserve', 'anomalie', 'subject', 'document') and target_id is not null)
  ),
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists visit_capture_routes_capture_idx
  on public.visit_capture_routes (capture_id);

-- Anti-doublon : une capture ne route pas deux fois vers la même cible matérialisée…
create unique index if not exists visit_capture_routes_uniq_target_idx
  on public.visit_capture_routes (capture_id, destination, target_id)
  where target_id is not null;
-- …ni deux fois vers la même destination-projection (journal/CR sans cible).
create unique index if not exists visit_capture_routes_uniq_projection_idx
  on public.visit_capture_routes (capture_id, destination)
  where target_id is null;

alter table public.visit_capture_routes enable row level security;

drop policy if exists "visit_capture_routes read" on public.visit_capture_routes;
create policy "visit_capture_routes read" on public.visit_capture_routes
  for select using (
    capture_id in (
      select c.id from public.visit_capture c
      join public.sites s on s.id = c.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );

comment on table public.visit_capture_routes is
  'Routage multi-destination d''une capture de visite (mig 163). 1 capture → N destinations : une photo nourrit plusieurs sorties. DEUX natures (contrainte visit_capture_routes_nature_chk) : route MATÉRIELLE (action/reserve/anomalie/subject/document) → target_id RENSEIGNÉ (+target_table) ; route de PROJECTION (journal/compte_rendu) → target_id NULL, ne jamais y chercher d''objet. Ne contient QUE ce que l''humain a validé (l''IA propose dans visit_capture.ai_prepared). RLS read par org via la capture ; écriture service-role.';
