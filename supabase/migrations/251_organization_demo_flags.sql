-- Migration 251 — Marqueurs de démonstration sur les organisations
--
-- Objectif : permettre une purge sécurisée des environnements de démo
-- sans risque de toucher aux vraies organisations.
--
-- Invariant : la commande demo:reset refuse de s'exécuter si
-- is_demo IS NOT TRUE. Aucun filtrage par nom d'organisation.
--
-- Usage :
--   is_demo = true          → l'organisation est un environnement de démo
--   demo_seed_key           → identifiant du jeu de données (ex : 'capse-2026-v1')
--                             permet de gérer plusieurs seeds indépendants

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_demo       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_seed_key text;

COMMENT ON COLUMN public.organizations.is_demo IS
  'true = organisation de démonstration ; autorise la purge via demo:reset.
   La commande de purge refuse de s''exécuter si ce flag n''est pas explicitement positionné.';

COMMENT ON COLUMN public.organizations.demo_seed_key IS
  'Identifiant stable du jeu de seed (ex : ''capse-2026-v1'').
   Permet de versionner et cibler un seed précis lors de la purge.';

-- Index pour accélérer la détection des orgs de démo (purge, rapport)
CREATE INDEX IF NOT EXISTS idx_organizations_is_demo
  ON public.organizations (is_demo)
  WHERE is_demo = true;
