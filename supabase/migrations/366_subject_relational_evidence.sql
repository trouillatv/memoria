-- 366_subject_relational_evidence.sql
-- V2 Option C — conservation de la PREUVE RELATIONNELLE perdue à la matérialisation.
--
-- Doctrine (verrouillée avec Vincent) :
--   - 1 occurrence = 1 état atomique d'un canonical_subject (INCHANGÉE, B2 préservé).
--   - 1 preuve source peut mentionner 1..N sujets et exprimer une relation entre eux.
--   - Cette table ne CRÉE AUCUNE relation métier. Elle conserve seulement la phrase source
--     rattachée aux sujets qu'elle mentionne, pour que V3 puisse plus tard la soumettre au
--     juge relationnel existant (→ canonical_subject_links suggested). Preuve ≠ relation.
--   - Additif, non destructif, aucun backfill.
--
-- Idempotence : rejouer la matérialisation d'une visite ne duplique pas la preuve
--   (UNIQUE(source_ref_id, evidence_hash) ; evidence_hash = md5 déterministe du texte normalisé).

create table if not exists public.subject_relational_evidence (
  id                 uuid        primary key default gen_random_uuid(),
  site_id            uuid        not null references public.sites(id) on delete cascade,

  -- Provenance : d'où vient la preuve (visite/réunion/PV) + run/report source.
  source_kind        text        not null check (source_kind in ('field_visit', 'meeting', 'historical_pdf')),
  source_ref_id      uuid        not null,
  -- Proposition source fine si la phrase vient d'une proposition unique (null si debrief/summary).
  source_proposal_id uuid        references public.site_knowledge_proposals(id) on delete set null,

  -- Verbatim source, borné, SANS reformulation LLM (contrat V2).
  evidence_text      text        not null,
  -- Canonical subjects mentionnés par la phrase (0..N). La validité (sujets réels du site,
  -- acteurs exclus) est garantie par le code de capture — pas de FK sur élément de tableau.
  subject_ids        uuid[]      not null default '{}',

  -- Hash déterministe pour l'idempotence (md5 du texte normalisé casse/espaces).
  evidence_hash      text        generated always as (md5(lower(btrim(evidence_text)))) stored,

  created_at         timestamptz not null default now()
);

create unique index if not exists sre_idempotence
  on public.subject_relational_evidence (source_ref_id, evidence_hash);
create index if not exists sre_site        on public.subject_relational_evidence (site_id);
create index if not exists sre_source_ref  on public.subject_relational_evidence (source_ref_id);
create index if not exists sre_subject_ids on public.subject_relational_evidence using gin (subject_ids);

-- RLS : lecture par les membres de l'organisation. L'écriture passe par le client admin
-- (pipeline visite, bypass RLS), comme les autres tables du pipeline canonique.
alter table public.subject_relational_evidence enable row level security;

create policy "sre_select" on public.subject_relational_evidence for select
  using (
    exists (
      select 1 from public.sites s
      join public.organization_memberships om on om.organization_id = s.organization_id
      where s.id = subject_relational_evidence.site_id
        and om.user_id = auth.uid()
    )
  );

comment on table public.subject_relational_evidence is
  'V2 — preuve source relationnelle conservée (phrase mentionnant 1..N canonical_subjects). NE crée AUCUNE relation ; consommée plus tard par V3. Occurrences atomiques inchangées.';
