-- P1-C1a — Marqueur de nature du canonical_subject : acteur vs sujet métier.
--
-- Contexte (root cause P1-B, 2026-08-27) : à la matérialisation d'un PV historique,
-- reconcileHistoricalPvCanonicalSubjects résout chaque thread MÉTIER contre un pool de
-- candidats qui inclut les canonical_subject représentant des ACTEURS (créés à
-- l'extraction depuis les propositions person/company). Un fait qui cite son acteur
-- (« Nettoyage… par KFT », « Contrôle… par Bureau Veritas ») est alors canonicalisé SUR
-- l'acteur, au lieu de créer/rejoindre un sujet métier durable. Résultat : aucune
-- continuité inter-PV.
--
-- Ce marqueur encode la NATURE du sujet, pas une propriété accidentelle, pour permettre
-- de retirer les acteurs du pool de résolution des faits métier. Il est fixé À LA CRÉATION
-- depuis la provenance (proposition person/company ou identité acteur explicite), jamais
-- déduit du label.
--
-- Additif, réversible (drop column). N'écrit AUCUNE occurrence, ne fusionne rien, ne
-- répare pas les rattachements existants (réservé à P1-C1b, après validation du dry-run).

alter table canonical_subject
  add column if not exists kind text not null default 'business_subject';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'canonical_subject_kind_check'
  ) then
    alter table canonical_subject
      add constraint canonical_subject_kind_check
      check (kind in ('actor', 'business_subject'));
  end if;
end $$;

comment on column canonical_subject.kind is
  'Nature du sujet canonique : actor (personne / entreprise / autorité — créé depuis une proposition person/company ou une identité acteur explicite) vs business_subject (thème, obligation, objet métier durable). Fixé à la création depuis la provenance, jamais déduit du label. Les faits métier ne se résolvent jamais sur un sujet kind=actor.';

-- Classification des lignes existantes par PROVENANCE (jamais par label) :
-- (a) un CS déjà lié à une company/contact est un acteur ;
-- (b) un CS porteur d'au moins un thread issu d'une proposition person/company est un acteur.
update canonical_subject
   set kind = 'actor'
 where kind <> 'actor'
   and (company_id is not null or contact_id is not null);

update canonical_subject cs
   set kind = 'actor'
 where cs.kind <> 'actor'
   and exists (
     select 1
       from subject_thread_identity sti
       join document_extraction_proposal p on p.subject_thread_id = sti.subject_thread_id
      where sti.canonical_subject_id = cs.id
        and p.proposal_family in ('person', 'company')
   );
