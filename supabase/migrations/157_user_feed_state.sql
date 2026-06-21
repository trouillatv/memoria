-- Migration 157 — État « vu » du fil par utilisateur (Vincent 2026-06-22).
--
-- Couche « Nouveau depuis hier » dans le dashboard : ce qui s'est passé (déclarations
-- QR des entreprises, photos reçues) depuis la dernière fois qu'on a regardé. Une
-- SEULE primitive neuve, volontairement : last_seen_at par utilisateur. Pas de
-- workflow, pas de notifications, pas de 5e écran — juste un filtre sur du frais.

create table if not exists public.user_feed_state (
  user_id      uuid primary key,
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.user_feed_state is
  'Dernière consultation du fil « Nouveau depuis hier » par utilisateur. « Tout marquer comme vu » = last_seen_at := now().';
