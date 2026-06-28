-- 170 — captured_knowledge : la connaissance tacite captée (Vincent 2026-06-28)
--
-- Primitive NEUTRE (≠ dix tables « engagement/risque/préférence entendus » = piège
-- ERP). Tout ce qui est dit/vu/promis/signalé d'utile sur un chantier, AVANT d'être
-- (ou sans jamais être) une action. Qualifiée progressivement par un `kind` (label
-- EXTENSIBLE, pas un enum figé : on en ajoutera). Cf. [[continuite-operationnelle-2026-05-22]].
--
-- RÈGLE D'OR (Vincent) : on ne crée JAMAIS une info utile sans ESSAYER de la relier.
-- Sans lien, rien ne ressortira au bon moment plus tard (le « Relier » de la boucle
-- capturer→structurer→relier→ressortir). D'où les colonnes de rattachement DÈS le
-- départ + le rattachement minimal garanti à la visite (source_id) et au site.
--
-- L'IA PROPOSE, L'HUMAIN VALIDE : V1 = saisie/qualification MANUELLE. L'extraction IA
-- (proposer type/titre/lien/échéance depuis un transcript) recâblera le moteur
-- existant (extractVoiceNoteAction) PLUS TARD. Aucun rappel automatique pour l'instant
-- (accumuler d'abord de la donnée propre). Pas un silo : relié à subjects/actions/zones.

create table if not exists public.captured_knowledge (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid,
  site_id            uuid not null references public.sites(id) on delete cascade,
  -- D'où vient l'info (la porte d'entrée — toutes alimentent le même patrimoine).
  source_type        text not null default 'manual'
                       check (source_type in ('visit', 'meeting', 'call', 'manual')),
  -- L'événement source (report/visite/réunion…), si applicable.
  source_id          uuid,
  -- Qualification PROGRESSIVE — label LIBRE et extensible (connus : promise / risk /
  -- context / missing_document / attention / preference / constraint / other).
  kind               text not null default 'other',
  title              text not null check (length(title) <= 500),
  body               text check (body is null or length(body) <= 8000),
  -- Cycle d'assertion vivante (cf. généalogie) : active → resolved | obsolete | dismissed.
  status             text not null default 'active'
                       check (status in ('active', 'resolved', 'obsolete', 'dismissed')),
  -- ── Les LIENS (la valeur). Au moins une tentative encouragée à la création. ──
  subject_id         uuid references public.subjects(id) on delete set null,
  action_id          uuid references public.site_actions(id) on delete set null,
  -- Zone / sous-périmètre (cf. [[hierarchie-adressage-memoire]]). FK différée (table scope).
  zone_id            uuid,
  -- Les captures brutes d'origine (provenance / auditabilité).
  source_capture_ids uuid[] not null default '{}',
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists captured_knowledge_site_status_idx
  on public.captured_knowledge (site_id, status);
create index if not exists captured_knowledge_source_idx
  on public.captured_knowledge (source_id) where source_id is not null;
create index if not exists captured_knowledge_subject_idx
  on public.captured_knowledge (subject_id) where subject_id is not null;

alter table public.captured_knowledge enable row level security;

drop policy if exists "captured_knowledge read" on public.captured_knowledge;
create policy "captured_knowledge read" on public.captured_knowledge
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

comment on table public.captured_knowledge is
  'Connaissance tacite captée (mig 170). Primitive NEUTRE qualifiée par kind (label extensible), reliée à site/sujet/action/zone + captures source. RÈGLE : jamais sans tentative de lien (sinon rien ne ressort au bon moment). V1 saisie manuelle (l''IA propose plus tard, ne crée jamais seule). Pas un silo : alimente le même patrimoine que visites/réunions/appels. RLS read par org ; écriture service-role.';
