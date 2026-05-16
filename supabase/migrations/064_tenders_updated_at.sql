-- Migration 064 : ajoute updated_at sur tenders pour tracker le début des analyses
ALTER TABLE public.tenders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.tenders SET updated_at = created_at WHERE updated_at IS NULL;
