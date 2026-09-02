-- Migration 376 — 7B-3 : backfill historique déterministe de report_id (et du
-- canonical_subject_id quand il est déterministe) sur les objets d'import créés
-- alors que le writer perdait encore la provenance (avant 374/375).
--
-- Prérequis (fermés) : 374 (action), 375 (observation/watchpoint), 297 (réserve),
-- 368 (échéance) → aucun writer courant ne perd plus de report_id connu. On peut
-- donc réparer l'historique sans risque de le recréer juste après.
--
-- DOCTRINE STRICTE — connu → propagé ; inconnu → laissé intact ; JAMAIS reconstitué
-- par titre/similarité/heuristique/nouvelle extraction :
--   · report_id : reconstruit UNIQUEMENT par la chaîne de matérialisation prouvée
--       objet → document_proposal_materialization → document_extraction_proposal
--             → extraction_run_id → site_reports
--     et SEULEMENT si cette chaîne aboutit à un report UNIQUE (HAVING = 1). Les
--     objets sans trace (manuels/natifs) et les cas ambigus (>1) ne sont PAS touchés.
--   · canonical_subject_id : seulement sur les familles qui portent la colonne
--       (site_actions, site_deadlines — PAS site_watchpoints), seulement si
--       proposal.subject_thread_id → subject_thread_identity donne un canonical
--       UNIQUE, et seulement si la colonne est encore NULL. Les échéances sans
--       thread (NO_DURABLE_SUBJECT) restent NULL.
--
-- Sûreté par objet : chaque UPDATE est auto-gardé (HAVING = 1 exclut l'ambigu,
-- `IS NULL` préserve l'existant et rend la migration idempotente). Un objet
-- ambigu au milieu de 500 prouvés ne bloque pas les 500 : il est simplement
-- absent des CTE de reconstruction.
--
-- Populations attendues (dry-run 2026-09-02) :
--   report_id restaurables : action 12, échéance 40, watchpoint 119 (0 ambigu)
--   canonical restaurables : action 12, échéance 7 (échéance : 23 déjà posés
--   intacts, 10 sans thread restent NULL) — watchpoint hors périmètre.

-- ── report_id ────────────────────────────────────────────────────────────────

WITH recon AS (
  SELECT m.target_entity_id AS eid,
         (array_agg(DISTINCT sr.id))[1] AS rid
  FROM public.document_proposal_materialization m
  JOIN public.document_extraction_proposal dep ON dep.id = m.proposal_id
  JOIN public.site_reports sr ON sr.extraction_run_id = dep.extraction_run_id
  WHERE m.target_entity_type = 'site_action'
  GROUP BY m.target_entity_id
  HAVING count(DISTINCT sr.id) = 1
)
UPDATE public.site_actions a
   SET report_id = recon.rid
  FROM recon
 WHERE a.id = recon.eid
   AND a.report_id IS NULL;

WITH recon AS (
  SELECT m.target_entity_id AS eid,
         (array_agg(DISTINCT sr.id))[1] AS rid
  FROM public.document_proposal_materialization m
  JOIN public.document_extraction_proposal dep ON dep.id = m.proposal_id
  JOIN public.site_reports sr ON sr.extraction_run_id = dep.extraction_run_id
  WHERE m.target_entity_type = 'site_deadline'
  GROUP BY m.target_entity_id
  HAVING count(DISTINCT sr.id) = 1
)
UPDATE public.site_deadlines d
   SET report_id = recon.rid
  FROM recon
 WHERE d.id = recon.eid
   AND d.report_id IS NULL;

WITH recon AS (
  SELECT m.target_entity_id AS eid,
         (array_agg(DISTINCT sr.id))[1] AS rid
  FROM public.document_proposal_materialization m
  JOIN public.document_extraction_proposal dep ON dep.id = m.proposal_id
  JOIN public.site_reports sr ON sr.extraction_run_id = dep.extraction_run_id
  WHERE m.target_entity_type = 'site_watchpoint'
  GROUP BY m.target_entity_id
  HAVING count(DISTINCT sr.id) = 1
)
UPDATE public.site_watchpoints w
   SET report_id = recon.rid
  FROM recon
 WHERE w.id = recon.eid
   AND w.report_id IS NULL;

-- ── canonical_subject_id (familles avec colonne uniquement) ───────────────────

WITH canon AS (
  SELECT m.target_entity_id AS eid,
         (array_agg(DISTINCT sti.canonical_subject_id))[1] AS cid
  FROM public.document_proposal_materialization m
  JOIN public.document_extraction_proposal dep ON dep.id = m.proposal_id
  JOIN public.subject_thread_identity sti ON sti.subject_thread_id = dep.subject_thread_id
  WHERE m.target_entity_type = 'site_action'
    AND sti.canonical_subject_id IS NOT NULL
  GROUP BY m.target_entity_id
  HAVING count(DISTINCT sti.canonical_subject_id) = 1
)
UPDATE public.site_actions a
   SET canonical_subject_id = canon.cid
  FROM canon
 WHERE a.id = canon.eid
   AND a.canonical_subject_id IS NULL;

WITH canon AS (
  SELECT m.target_entity_id AS eid,
         (array_agg(DISTINCT sti.canonical_subject_id))[1] AS cid
  FROM public.document_proposal_materialization m
  JOIN public.document_extraction_proposal dep ON dep.id = m.proposal_id
  JOIN public.subject_thread_identity sti ON sti.subject_thread_id = dep.subject_thread_id
  WHERE m.target_entity_type = 'site_deadline'
    AND sti.canonical_subject_id IS NOT NULL
  GROUP BY m.target_entity_id
  HAVING count(DISTINCT sti.canonical_subject_id) = 1
)
UPDATE public.site_deadlines d
   SET canonical_subject_id = canon.cid
  FROM canon
 WHERE d.id = canon.eid
   AND d.canonical_subject_id IS NULL;
