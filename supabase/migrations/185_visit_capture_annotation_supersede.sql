-- 185 — Annotation : « remplacer l'affichage par la version annotée ».
--
-- Principe (décision produit) : une annotation est une INTERPRÉTATION ; l'original
-- reste la PREUVE et n'est JAMAIS perdu. Mais 99 % du temps, c'est la version
-- annotée qu'on veut revoir. À l'enregistrement, le conducteur choisit :
--   « Conserver les deux »        → rien de spécial (les deux captures visibles) ;
--   « Remplacer l'affichage »     → l'original est ARCHIVÉ (masqué des vues par
--                                   défaut, jamais supprimé) et l'annotée le remplace.
--
-- `annotated_original_id` : sur la capture ANNOTÉE, pointe la photo d'origine
-- (permet un futur « Voir l'original »). `hidden_at` : sur l'ORIGINAL archivé —
-- masqué des listes par défaut (listVisitCaptures), conservé en base, réversible.
alter table public.visit_capture
  add column if not exists annotated_original_id uuid;

alter table public.visit_capture
  add column if not exists hidden_at timestamptz;

comment on column public.visit_capture.annotated_original_id is
  'Photo d''origine dont cette capture est la version ANNOTÉE (mig 185). Permet « Voir l''original ».';
comment on column public.visit_capture.hidden_at is
  'Capture ARCHIVÉE (mig 185) — masquée des vues par défaut mais jamais supprimée. Posé sur l''original quand on choisit « Remplacer l''affichage par la version annotée ».';
