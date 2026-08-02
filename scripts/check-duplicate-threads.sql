-- Vérifier si les doublons visibles partagent le même subject_thread_id

-- 1. Regard R4
SELECT
  label,
  proposal_family,
  subject_thread_id,
  extraction_run_id,
  created_at
FROM document_extraction_proposal
WHERE label ILIKE '%R4%'
  AND label ILIKE '%chute%'
ORDER BY subject_thread_id, created_at;

-- 2. Zone déshuileur
SELECT
  label,
  proposal_family,
  subject_thread_id,
  extraction_run_id,
  created_at
FROM document_extraction_proposal
WHERE label ILIKE '%déshuileur%'
ORDER BY subject_thread_id, created_at;

-- 3. Busage plateforme-lagunage
SELECT
  label,
  proposal_family,
  subject_thread_id,
  extraction_run_id,
  created_at
FROM document_extraction_proposal
WHERE label ILIKE '%busage%'
  AND label ILIKE '%lagunage%'
ORDER BY subject_thread_id, created_at;

-- 4. Épaisseurs d'enrobage
SELECT
  label,
  proposal_family,
  subject_thread_id,
  extraction_run_id,
  created_at
FROM document_extraction_proposal
WHERE label ILIKE '%enrobage%'
ORDER BY subject_thread_id, created_at;

-- 5. Essais du 20/02
SELECT
  label,
  proposal_family,
  subject_thread_id,
  extraction_run_id,
  created_at
FROM document_extraction_proposal
WHERE label ILIKE '%essais%'
  AND (label ILIKE '%20%' OR label ILIKE '%02%')
ORDER BY subject_thread_id, created_at;
