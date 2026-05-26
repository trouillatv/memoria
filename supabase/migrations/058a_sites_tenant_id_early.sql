-- Migration 058a — sites.tenant_id, placée AVANT 059 (Vincent 2026-05-26)
--
-- Correctif de reproductibilité : 059_find_similar_for_tenant.sql et
-- 060_knowledge_chunks.sql utilisent sites.tenant_id, mais la migration qui
-- le crée (061_sites_tenant_id.sql) est numérotée APRÈS → un rebuild from
-- scratch (db reset / CI) échouait à 059. On crée donc la colonne ici, avant.
-- Contenu IDEMPOTENT (identique à 061) : no-op sur le cloud déjà appliqué,
-- et 061 reste un no-op lors d'un rebuild.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
    FROM public.sites
    WHERE tenant_id IS NOT NULL
    LIMIT 1;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := gen_random_uuid();
  END IF;

  UPDATE public.sites SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  EXECUTE 'ALTER TABLE public.sites ALTER COLUMN tenant_id SET DEFAULT ''' || v_tenant_id || '''';
END $$;

ALTER TABLE public.sites
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sites_tenant_id_idx
  ON public.sites (tenant_id);
