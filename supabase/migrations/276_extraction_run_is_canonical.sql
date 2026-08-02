-- migration 276 : run canonique par document
-- Invariant : 1 document historique = 1 snapshot temporel = 1 run canonique.
-- Les re-analyses d'un même PDF restent en base comme historique technique
-- mais seul le run is_canonical = true est visible dans les vues temporelles.

ALTER TABLE public.document_extraction_run
  ADD COLUMN IF NOT EXISTS is_canonical boolean NOT NULL DEFAULT false;

-- Backfill : pour chaque document, marquer le run ready_for_review
-- ayant le plus grand nombre de propositions.
-- Tiebreaker : le plus ancien (premier run à avoir produit ce résultat).
WITH ranked AS (
  SELECT
    r.id,
    ROW_NUMBER() OVER (
      PARTITION BY r.document_id
      ORDER BY COALESCE(pc.nb, 0) DESC, r.created_at ASC
    ) AS rn
  FROM public.document_extraction_run r
  LEFT JOIN (
    SELECT extraction_run_id, COUNT(*) AS nb
    FROM public.document_extraction_proposal
    GROUP BY extraction_run_id
  ) pc ON pc.extraction_run_id = r.id
  WHERE r.status = 'ready_for_review'
)
UPDATE public.document_extraction_run
SET is_canonical = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);
