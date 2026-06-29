-- 174 — « Marquer pour le mémoire technique » (Vincent 2026-06-29)
--
-- Sur le terrain, Guillaume SAIT quelles observations comptent pour sa réponse AO
-- (« cette photo, ce vocal, je m'en resservirai »). Deux semaines plus tard, il ne
-- veut pas refouiller 150 captures : il repart des ~12 qu'il a lui-même marquées.
--
-- DOCTRINE (cf. [[visite-trois-temps]]) : le terrain reste « collecte sans réfléchir ».
-- Le ⭐ est OPTIONNEL et ADDITIF — un marque-page, jamais requis, qui ne route rien
-- ni ne crée d'objet métier. Il ne remplace pas le tri (voiture/bureau) : il l'aide.

alter table public.visit_capture
  add column if not exists starred boolean not null default false;

-- Retrouver vite les éléments marqués d'un lieu (collection « à réutiliser »).
create index if not exists visit_capture_starred_idx
  on public.visit_capture(site_id) where starred;
