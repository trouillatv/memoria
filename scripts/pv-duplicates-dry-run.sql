-- DRY-RUN — Doublons de PV historiques par chantier
-- Aucune modification : SELECT uniquement.
--
-- Objectif : identifier, pour chaque groupe de documents identiques (même
-- content_hash sur le même chantier), lequel conserver et quels objets
-- descendants seraient touchés par un nettoyage.
--
-- Usage : coller dans Supabase Dashboard > SQL Editor.
-- Remplacer <SITE_ID> par l'UUID du chantier cible.

-- ── 1. Groupes de doublons par content_hash ───────────────────────────────────

SELECT
  dl.target_id                            AS site_id,
  d.effective_date,
  d.content_hash,
  COUNT(*)                                AS nb_documents,
  array_agg(d.id ORDER BY d.created_at)  AS document_ids,
  array_agg(d.filename ORDER BY d.created_at) AS filenames,
  array_agg(d.created_at ORDER BY d.created_at) AS created_ats
FROM documents d
JOIN document_links dl
  ON dl.document_id = d.id
  AND dl.target_type = 'site'
WHERE d.document_type = 'historical_visit_report'
  AND d.content_hash IS NOT NULL
  -- AND dl.target_id = '<SITE_ID>'  -- décommenter pour filtrer par chantier
GROUP BY dl.target_id, d.effective_date, d.content_hash
HAVING COUNT(*) > 1
ORDER BY dl.target_id, d.effective_date;

-- ── 2. Pour chaque document doublon : ses extraction_runs ─────────────────────

SELECT
  d.id                  AS document_id,
  d.filename,
  d.effective_date,
  d.content_hash,
  r.id                  AS run_id,
  r.status              AS run_status,
  r.created_at          AS run_created_at,
  (SELECT COUNT(*) FROM document_extraction_proposal p WHERE p.extraction_run_id = r.id) AS nb_proposals
FROM documents d
JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
JOIN document_extraction_run r ON r.document_id = d.id
WHERE d.document_type = 'historical_visit_report'
  AND d.content_hash IN (
    SELECT d2.content_hash
    FROM documents d2
    JOIN document_links dl2 ON dl2.document_id = d2.id AND dl2.target_type = 'site'
    WHERE d2.document_type = 'historical_visit_report'
    GROUP BY dl2.target_id, d2.content_hash
    HAVING COUNT(*) > 1
  )
  -- AND dl.target_id = '<SITE_ID>'
ORDER BY d.effective_date, d.created_at, r.created_at;

-- ── 3. Objets matérialisés par document : ce qui serait orphelin si supprimé ──

SELECT
  d.id                  AS document_id,
  d.filename,
  d.effective_date,
  dpm.target_entity_type,
  COUNT(*)              AS nb_objets_materialises
FROM documents d
JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
JOIN document_extraction_run r ON r.document_id = d.id
JOIN document_extraction_proposal dep ON dep.extraction_run_id = r.id
JOIN document_proposal_materialization dpm ON dpm.proposal_id = dep.id
WHERE d.document_type = 'historical_visit_report'
  AND d.content_hash IN (
    SELECT d2.content_hash
    FROM documents d2
    JOIN document_links dl2 ON dl2.document_id = d2.id AND dl2.target_type = 'site'
    WHERE d2.document_type = 'historical_visit_report'
    GROUP BY dl2.target_id, d2.content_hash
    HAVING COUNT(*) > 1
  )
  -- AND dl.target_id = '<SITE_ID>'
GROUP BY d.id, d.filename, d.effective_date, dpm.target_entity_type
ORDER BY d.effective_date, d.filename, dpm.target_entity_type;

-- ── 4. site_reports liés (visites historiques créées) ─────────────────────────

SELECT
  d.id                  AS document_id,
  d.filename,
  d.effective_date,
  sr.id                 AS site_report_id,
  sr.origin,
  sr.created_at         AS report_created_at
FROM documents d
JOIN document_links dl ON dl.document_id = d.id AND dl.target_type = 'site'
JOIN document_extraction_run r ON r.document_id = d.id
JOIN site_reports sr ON sr.extraction_run_id = r.id
WHERE d.document_type = 'historical_visit_report'
  AND d.content_hash IN (
    SELECT d2.content_hash
    FROM documents d2
    JOIN document_links dl2 ON dl2.document_id = d2.id AND dl2.target_type = 'site'
    WHERE d2.document_type = 'historical_visit_report'
    GROUP BY dl2.target_id, d2.content_hash
    HAVING COUNT(*) > 1
  )
  -- AND dl.target_id = '<SITE_ID>'
ORDER BY d.effective_date, d.created_at;

-- ── Résumé attendu ────────────────────────────────────────────────────────────
--
-- Pour chaque hash dupliqué, le document CANONIQUE à conserver est :
--   - celui qui a le run avec le plus de propositions (= extraction la plus complète)
--   - ou, à égalité, le plus récent (dernier import)
--
-- Documents à supprimer : tous sauf le canonique, à condition que leurs objets
-- matérialisés soient soit vides, soit réattachés au document canonique.
--
-- Étapes de nettoyage (à valider manuellement avant execution) :
--   1. Identifier le document canonique (run avec MAX(nb_proposals))
--   2. Pour les non-canoniques : vérifier qu'ils n'ont aucun objet matérialisé
--      différent du canonique (requête 3 ci-dessus)
--   3. Supprimer document_links, document_extraction_run, document_extraction_proposal,
--      puis documents pour les non-canoniques
--   4. Le document canonique conserve ses objets matérialisés intacts
