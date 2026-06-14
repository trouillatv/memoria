-- Migration 098 : ajoute recipient_label à intervention_tokens
-- Permet d'identifier pour qui le lien a été généré (ex: "Livraison Dumont", "Bureau contrôle")
-- Champ libre, optionnel.

alter table public.intervention_tokens
  add column if not exists recipient_label text;
