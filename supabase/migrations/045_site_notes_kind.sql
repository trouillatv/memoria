-- Migration 045 — Extension site_notes : kind + active_until (Phase 3.1).
--
-- Pour distinguer deux objets dans la même mémoire vivante :
--   - kind='note' : observation descriptive passée, pas de péremption.
--   - kind='a_savoir' : information utile à l'arrivée sur site, avec date
--     d'expiration optionnelle. Reste descriptif du lieu, JAMAIS directif
--     envers les personnes (verrou V4).
--
-- Aucune notion d'acquittement, aucun tracking de lecture. La consigne
-- (renommée « À savoir ») s'affiche, point. Si l'agent ne la lit pas, c'est
-- entre lui et son responsable hors système.

alter table public.site_notes
  add column if not exists kind text not null default 'note'
    check (kind in ('note', 'a_savoir')),
  add column if not exists active_until date;

-- Contrainte : active_until n'a de sens que pour les a_savoir.
alter table public.site_notes
  drop constraint if exists chk_active_until_only_a_savoir;
alter table public.site_notes
  add constraint chk_active_until_only_a_savoir
  check (active_until is null or kind = 'a_savoir');

-- Index partiel : À savoir actifs (kind=a_savoir, non expirés, non supprimés).
-- Optimise l'affichage de la bannière sur la fiche site et au démarrage
-- d'une intervention.
create index if not exists idx_site_notes_a_savoir_active
  on public.site_notes(site_id, created_at desc)
  where kind = 'a_savoir'
    and deleted_at is null
    and (active_until is null or active_until >= current_date);

comment on column public.site_notes.kind is
  '« note » = observation passée descriptive. « a_savoir » = info utile à l''arrivée, optionnellement temporaire (active_until).';
comment on column public.site_notes.active_until is
  'Date d''expiration pour les a_savoir temporaires. NULL = info permanente. Au-delà, l''entrée bascule en historique sans suppression.';
