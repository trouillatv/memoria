-- Migration 277 : contrainte unique partielle sur le run canonique
-- Verrouille au niveau PostgreSQL l'invariant "au plus 1 run canonique par document".
-- Sans cet index, deux extractions simultanées pourraient toutes deux se proclamer
-- canoniques, et le TypeScript seul ne suffit pas à garantir l'unicité.

CREATE UNIQUE INDEX idx_extraction_run_one_canonical_per_doc
  ON public.document_extraction_run (document_id)
  WHERE is_canonical = true;
