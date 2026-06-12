-- Migration 093 : home_preference sur users
--
-- Pilote la porte d'entrée de l'application : dashboard (pilotage) ou terrain (/m).
-- Pas un nouveau rôle — uniquement l'accueil par défaut.
-- Valeurs : 'dashboard' (défaut) | 'terrain'
-- Exemple : Guillaume → dashboard, Adrien → terrain, Fred (chef_equipe) → terrain forcé par rôle.

alter table public.users
  add column if not exists home_preference text not null default 'dashboard'
  check (home_preference in ('dashboard', 'terrain'));
