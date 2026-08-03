-- Lot : Décision → acteur (FK structurelle)
-- Ajoute deux FK nullable sur site_decisions pour relier une décision
-- à l'entreprise et/ou au contact responsable (décisionnaire).
-- Résolution via Chemin B (linkedActorTemporaryKey) côté pipeline TS.

ALTER TABLE public.site_decisions
  ADD COLUMN IF NOT EXISTS decisionnaire_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decisionnaire_contact_id uuid REFERENCES public.company_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_decisions_dec_company
  ON public.site_decisions(decisionnaire_company_id)
  WHERE decisionnaire_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_site_decisions_dec_contact
  ON public.site_decisions(decisionnaire_contact_id)
  WHERE decisionnaire_contact_id IS NOT NULL;
