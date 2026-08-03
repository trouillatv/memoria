-- Réserve → responsable de levée (2026-08-03)
--
-- issued_by text : qui constate / émet la réserve (MOE, architecte, bureau de contrôle).
--   Resté tel quel : auteur institutionnel, pas nécessairement une entreprise du graphe.
--
-- responsible_company_id uuid FK : entreprise à qui incombe la levée.
--   Résolu au moment de la matérialisation depuis linkedActorTemporaryKey (pipeline TS post-RPC).
--   NULL si la réserve ne nomme pas explicitement de responsable — jamais de fallback automatique.

ALTER TABLE public.site_reserve
  ADD COLUMN IF NOT EXISTS responsible_company_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_reserve_responsible_company
  ON public.site_reserve(responsible_company_id)
  WHERE responsible_company_id IS NOT NULL;

COMMENT ON COLUMN public.site_reserve.responsible_company_id IS
  'Entreprise responsable de la levée. Distinct de issued_by (émetteur/constatant). Alimenté par le pipeline historique depuis linkedActorTemporaryKey.';
