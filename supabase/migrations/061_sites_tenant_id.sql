-- Migration 061 — Ajoute tenant_id à sites pour le pilote single-tenant (2026-05-16)
--
-- Contexte : le projet est single-tenant (AGP, une seule entreprise).
-- Toutes les lignes partagent le même UUID tenant.
-- Ce UUID est généré dynamiquement et stocké comme DEFAULT pour les futures lignes.
--
-- À appliquer AVANT 059 (find_similar_traces_for_tenant) et 060 (knowledge_chunks).

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Réutilise l'UUID existant si la migration tourne une 2e fois (idempotence)
  SELECT tenant_id INTO v_tenant_id
    FROM public.sites
    WHERE tenant_id IS NOT NULL
    LIMIT 1;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := gen_random_uuid();
  END IF;

  -- Toutes les lignes existantes reçoivent le même UUID
  UPDATE public.sites SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  -- Le DEFAULT garantit que les nouvelles lignes héritent du même tenant
  EXECUTE 'ALTER TABLE public.sites ALTER COLUMN tenant_id SET DEFAULT ''' || v_tenant_id || '''';
END $$;

ALTER TABLE public.sites
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sites_tenant_id_idx
  ON public.sites (tenant_id);

COMMENT ON COLUMN public.sites.tenant_id IS
  'UUID unique du tenant AGP (pilote single-tenant). '
  'Toutes les lignes partagent le même UUID. '
  'Future multi-tenant : une ligne par organisation.';
