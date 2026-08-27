-- P-UI-R2b — trace structurée de l'hypothèse « même objet » sur une suggestion de rapprochement.
--
-- Doctrine (Vincent 2026-08-27) : ne PAS falsifier recommendation='merge' pour réutiliser l'UI.
-- On conserve les trois notions séparées :
--   verdict        — ce que le juge conclut (same_subject | related | distinct | uncertain)
--   recommendation — ce que le juge conseille (merge | link | none)
--   same_object_hypothesis — « ces deux sujets pourraient malgré tout être le même objet »
--     (significatif uniquement quand verdict='related'). Permet de présenter à l'humain une
--     question « Même sujet ? » sans prétendre que l'IA a recommandé la fusion.
--
-- Additif, réversible. Anciennes lignes → false (défaut prudent). Pas de backfill.

alter table canonical_subject_similarity_suggestion
  add column if not exists same_object_hypothesis boolean not null default false;

comment on column canonical_subject_similarity_suggestion.same_object_hypothesis is
  'Uniquement significatif quand verdict=related : hypothèse que les deux sujets désignent le même objet métier durable malgré une confiance insuffisante pour same_subject. Sert à présenter une question « Même sujet ? » à l''humain sans falsifier recommendation. Défaut false.';
