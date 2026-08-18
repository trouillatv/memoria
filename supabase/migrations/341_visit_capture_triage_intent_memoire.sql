-- 341_visit_capture_triage_intent_memoire.sql
-- Corrige une régression introduite par le commit a1fc7916 (2026-08-18) : le
-- code applicatif distingue désormais une décision humaine explicite
-- « Documenter la visite » (triage_intent='memoire') d'une capture jamais
-- qualifiée (triage_intent=null) — cf. lib/db/visit-captures.ts
-- (CaptureTriageIntent inclut 'memoire' depuis ce commit) et debrief-actions.ts
-- (MAP.memoire.intent='memoire'). Mais la contrainte CHECK posée en 182
-- (visit_capture_triage_intent_check) n'autorisait que null/action/follow/
-- reserve : toute capture taguée « Documenter la visite » violait la
-- contrainte en base, provoquant l'échec systématique « Échec du tri » au
-- débrief express, quel que soit le contenu de la légende.
alter table public.visit_capture
  drop constraint if exists visit_capture_triage_intent_check;

alter table public.visit_capture
  add constraint visit_capture_triage_intent_check
    check (triage_intent is null or triage_intent in ('action', 'follow', 'reserve', 'memoire'));

comment on column public.visit_capture.triage_intent is
  'Suite décidée au traitement des captures (mig 168, étendu 182, 341) : action | follow | reserve | memoire | null(=jamais qualifiée). memoire = décision humaine explicite « Documenter la visite » (mig 341, distincte de null depuis a1fc7916). La décision est ENREGISTRÉE ; la matérialisation (action/réserve, lien sujet, projection CR) se fait au bureau. Vocabulaire métier only.';
