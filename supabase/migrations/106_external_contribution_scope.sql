-- Contributions externes scopées (2026-06-15)
--
-- Évolution validée (Vincent) : partager une intervention à un externe ne doit
-- plus tout exposer. Le token DEVIENT une « contribution externe » :
--   - recipient_label = l'entreprise / l'intervenant externe
--   - intervention_token_items = le PÉRIMÈTRE autorisé (sous-ensemble de la checklist)
--   - l'externe ne voit / ne coche / ne photographie QUE ses items
--   - le serveur REFUSE toute action hors périmètre (garde-fou non négociable)
--   - signature unique au niveau token/contribution (pas par item)
--   - chaque item exécuté porte executed_by_token_id (= entreprise, jamais salarié)
--
-- Règle métier : une tâche a au plus UN exécutant externe principal ; elle reste
-- contrôlable/clôturable en interne (dimension orthogonale).
-- Fallback : un token sans item assigné = contribution sur l'intervention entière.

-- ── Périmètre d'une contribution externe ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intervention_token_items (
  token_id          uuid NOT NULL REFERENCES public.intervention_tokens(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES public.intervention_checklist_items(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS iti_item_idx ON public.intervention_token_items (checklist_item_id);

COMMENT ON TABLE public.intervention_token_items IS
  'Périmètre d''une contribution externe : items de checklist qu''un token peut cocher/photographier. Le serveur refuse toute action hors de ce périmètre.';

-- ── Exécutant externe par item (badge entreprise) ──────────────────────────
ALTER TABLE public.intervention_checklist_items
  ADD COLUMN IF NOT EXISTS executed_by_token_id uuid REFERENCES public.intervention_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz;

CREATE INDEX IF NOT EXISTS ici_executed_token_idx
  ON public.intervention_checklist_items (executed_by_token_id)
  WHERE executed_by_token_id IS NOT NULL;

COMMENT ON COLUMN public.intervention_checklist_items.executed_by_token_id IS
  'Exécutant externe (entreprise via token.recipient_label) ayant réalisé cet item. NULL = interne / non délégué. Jamais un salarié nommé (doctrine anti-pointage).';

-- ── RLS (service_role only, comme les autres tables du domaine) ─────────────
ALTER TABLE public.intervention_token_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.intervention_token_items
  FOR ALL USING (auth.role() = 'service_role');
