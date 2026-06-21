-- Migration 154 — Provenance documentaire d'une obligation (Vincent 2026-06-22, Sprint B).
--
-- Le pont AO→chantier : un engagement d'AO validé devient une obligation de chantier,
-- en CONSERVANT son origine contractuelle. C'est ce qui fait démarrer l'Histoire du
-- sujet au document source : « 12 fév — Exigé au CCTP p.148 : "Le DOE devra…" ».
--
-- Garde-fou : on NE fusionne PAS les tables. L'engagement garde son monde AO ;
-- l'obligation vit côté chantier ; ces colonnes font le LIEN (pont, pas fusion).

alter table public.site_obligation
  add column if not exists origin_tender_id     uuid references public.tenders(id) on delete set null,
  add column if not exists origin_engagement_id uuid references public.engagements(id) on delete set null,
  add column if not exists origin_excerpt       text,
  add column if not exists origin_ref           text,
  add column if not exists origin_date          timestamptz;

-- Empêche de matérialiser deux fois le même engagement sur un même site.
create unique index if not exists site_obligation_origin_engagement_uniq
  on public.site_obligation (site_id, origin_engagement_id)
  where origin_engagement_id is not null;

comment on column public.site_obligation.origin_engagement_id is
  'Engagement d''AO d''origine (pont, pas fusion). Permet de remonter à la clause source.';
comment on column public.site_obligation.origin_ref is
  'Référence source dénormalisée pour affichage, ex. « CCTP · p.148 ».';
comment on column public.site_obligation.origin_excerpt is
  'Extrait verbatim de la clause source (premier événement de l''Histoire du sujet).';
comment on column public.site_obligation.origin_date is
  'Date d''origine (réception de l''AO) — situe la provenance au début de la timeline.';
