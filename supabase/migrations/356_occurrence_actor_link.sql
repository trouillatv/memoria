-- P1-C1b (partie workflow) — Relation ACTEUR ↔ OCCURRENCE (rôle dans un fait daté).
--
-- Doctrine (Vincent 2026-08-27) : « fait métier + acteur » doit produire
--   sujet   = thème métier                 ← garanti par P1-C1a (kind=actor hors pool)
--   occurrence = le fait daté
--   acteur  = entité LIÉE À L'OCCURRENCE avec un RÔLE, jamais le sujet, jamais responsable.
--
-- Le lien est porté par l'OCCURRENCE (fait daté), pas par le sujet durable : « Nettoyage
-- conduits » peut être réalisé par KFT en 2024, par un autre prestataire en 2027. L'acteur
-- n'est donc pas une propriété du sujet.
--
-- actor_subject_id référence un canonical_subject kind='actor' (registre canonique existant
-- des acteurs — on ne duplique PAS les acteurs dans site_knowledge_entities).
--
-- Vocabulaire relation_type volontairement PETIT au départ (étendable) :
--   performed_by   — « réalisé/contrôlé/effectué par X »
--   proposed_by    — « proposition de X »
--   validated_with — « validé/décision avec X » (autorité participant à une validation)
--   mentioned      — présence prouvée sans rôle explicite (défaut prudent)
-- PAS de responsible_for dans ce lot : « réalisé par KFT » ≠ « KFT doit le refaire ».
--
-- Provenance : le lien est explicable via occurrence_id → source_ref_id (document) ; on ne
-- recopie pas la preuve. evidence_cue garde l'indice ayant déterminé le rôle (facultatif).
--
-- Additif. ON DELETE CASCADE sur occurrence_id : une régénération d'occurrence reconstruit
-- proprement ses liens (pas d'orphelins).

-- Nettoyage de l'ébauche précédente (colonne uuid[] abandonnée au profit de la table).
alter table canonical_subject_occurrence drop column if exists actor_subject_ids;

create table if not exists canonical_subject_occurrence_actor_link (
  id                uuid        primary key default gen_random_uuid(),
  occurrence_id     uuid        not null references canonical_subject_occurrence(id) on delete cascade,
  actor_subject_id  uuid        not null references canonical_subject(id) on delete cascade,
  relation_type     text        not null
    check (relation_type in ('performed_by', 'proposed_by', 'validated_with', 'mentioned')),
  source            text        not null default 'auto_historical'
    check (source in ('auto_historical', 'manual', 'llm')),
  evidence_cue      text,
  created_at        timestamptz not null default now(),
  unique (occurrence_id, actor_subject_id, relation_type)
);

create index if not exists idx_csoal_occurrence on canonical_subject_occurrence_actor_link(occurrence_id);
create index if not exists idx_csoal_actor      on canonical_subject_occurrence_actor_link(actor_subject_id);

comment on table canonical_subject_occurrence_actor_link is
  'Rôle d''un acteur (canonical_subject kind=actor) dans un fait daté (occurrence). Lien au niveau OCCURRENCE, jamais du sujet durable. Alimenté déterministiquement à l''import historique. Jamais responsible_for.';

alter table canonical_subject_occurrence_actor_link enable row level security;

-- Lecture : membres de l'organisation du chantier (via l'occurrence). Écriture = admin (bypass RLS).
create policy "csoal_select" on canonical_subject_occurrence_actor_link for select
  using (
    exists (
      select 1 from canonical_subject_occurrence o
      join sites s on s.id = o.site_id
      join organization_memberships om on om.organization_id = s.organization_id
      where o.id = canonical_subject_occurrence_actor_link.occurrence_id
        and om.user_id = auth.uid()
    )
  );
