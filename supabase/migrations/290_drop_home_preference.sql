-- Migration 290 — Supprime home_preference de la table users.
-- La surface par défaut est désormais déterminée par le rôle et le support
-- (PWA standalone vs navigateur), sans préférence stockée en base.
-- Doctrine : chef_equipe → /m ; PWA standalone → /m ; sinon → /dashboard.

ALTER TABLE public.users DROP COLUMN IF EXISTS home_preference;
