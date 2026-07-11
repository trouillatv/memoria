-- 195 — Point de repère photographique (« reprendre exactement le même point
-- de vue »). Né d'un rituel observé : le conducteur se replace chaque matin au
-- même endroit pour photographier l'évolution — de mémoire, sans aide.
--
-- Une photo épinglée « point de repère » (is_viewpoint) devient l'ANCRE d'une
-- série ; chaque reprise (photo cadrée sur le fantôme de la précédente) pointe
-- l'ancre via viewpoint_of. La série ordonnée raconte l'évolution du même
-- cadrage dans le temps — sans IA, sans %, sans timeline calculée.
--
-- Rollback : drop des deux colonnes (aucune donnée existante impactée).

alter table public.visit_capture
  add column if not exists is_viewpoint boolean not null default false;

alter table public.visit_capture
  add column if not exists viewpoint_of uuid references public.visit_capture(id) on delete set null;

-- Retrouver vite les séries d'un chantier (ancres + reprises).
create index if not exists visit_capture_viewpoint_site_idx
  on public.visit_capture (site_id)
  where is_viewpoint or viewpoint_of is not null;

comment on column public.visit_capture.is_viewpoint is
  'Photo épinglée « point de repère » (mig 195) : ancre d''une série à reprendre au même cadrage à chaque visite.';
comment on column public.visit_capture.viewpoint_of is
  'Reprise d''un point de repère (mig 195) : pointe la capture ANCRE (is_viewpoint). La série = ancre + reprises, ordonnée par coalesce(captured_at, created_at).';
