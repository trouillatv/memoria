-- 330 — copilot_proposal_id sur canonical_subject_links + intent RELATION_CLAIM (P4-D1).
--
-- RELATION_CLAIM (cadrage Vincent 2026-08-17, mandat P4-D1) : une phrase
-- affirme une relation causale explicite et déterministe entre deux sujets
-- déjà suivis (« Le SSI dépend de la mise sous tension »). Réutilise
-- STRICTEMENT canonical_subject_links + canonical_subject_link_evidence
-- (mig 316, moteur P0-B1) — aucun nouveau type de relation, aucune nouvelle
-- table. Les deux sujets doivent être résolus avec certitude
-- (resolveCanonicalSubjectReference, même resolver que OBSERVATION/FACT) ;
-- une ambiguïté sur l'un des deux → clarification, jamais d'écriture.
--
-- Différence avec le moteur P0-B1 (produceRelationsFromOccurrences) : celui-ci
-- écrit status='suggested' depuis une co-occurrence statistique qualifiée par
-- Gemini. RELATION_CLAIM écrit status='confirmed' DIRECTEMENT — l'utilisateur
-- vient d'affirmer et de valider la relation lui-même, il n'y a rien à
-- suggérer. Même différence que OBSERVATION/FACT (écriture directe) vs le
-- pipeline d'extraction PDF (proposals).
--
-- Hors périmètre (ne doit jamais être absorbé par RELATION_CLAIM, cf. audit
-- P4-D et mig 327) : acteur↔sujet ("Clim Expair s'occupe de la climatisation"),
-- affiliation acteur ("Jérôme travaille chez BECIB"), document↔sujet, action↔
-- objet, anaphore ("cette action", "ce document") — tous des briques futures
-- séparées, pas des extensions de canonical_subject_links.
--
-- Idempotence : même mécanique que actor_alias.copilot_proposal_id (mig 327)
-- et site_knowledge_entries.copilot_proposal_id (mig 329) — clé générée côté
-- client à l'affichage du brouillon, pas une FK, index unique partiel pour
-- absorber le double-clic "Valider" sans doublon.
--
-- Pas de nouvelle colonne pour l'evidence : canonical_subject_link_evidence
-- porte déjà evidence_text NOT NULL (invariant P0-B1) — la phrase littérale de
-- l'utilisateur y est écrite telle quelle, occurrence_id/source_proposal_id
-- restant NULL (pas d'occurrence terrain source pour une affirmation directe).

alter table public.canonical_subject_links
  add column if not exists copilot_proposal_id uuid;

comment on column public.canonical_subject_links.copilot_proposal_id is
  'Clé d''idempotence générée côté client à l''affichage du brouillon RELATION_CLAIM (même mécanique que actor_alias.copilot_proposal_id, mig 327 ; site_knowledge_entries.copilot_proposal_id, mig 329) — pas une FK.';

create unique index if not exists canonical_subject_links_copilot_proposal_id_key
  on public.canonical_subject_links (copilot_proposal_id)
  where copilot_proposal_id is not null;

-- Élargit la contrainte posée en mig 294, déjà étendue en mig 328/329, pour
-- accepter 'relation_claim' — même défaut silencieux à éviter que documenté
-- en 328 (logCopilotInteraction est best-effort).

alter table public.copilot_interactions
  drop constraint if exists copilot_proposal_kind_chk;

alter table public.copilot_interactions
  add constraint copilot_proposal_kind_chk check (
    proposal_kind is null or proposal_kind in (
      'action', 'visit_item', 'schedule_visit', 'schedule_meeting', 'observation', 'actor_alias', 'fact', 'relation_claim'
    )
  );
