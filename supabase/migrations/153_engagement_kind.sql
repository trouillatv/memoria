-- Migration 153 — Typage prescriptif des engagements (Vincent 2026-06-22, Sprint 1).
--
-- Recadrage : un « engagement » n'est pas une chose unique. C'est la NATURE qui
-- détermine ce qu'on en attend (preuve, destination, surfaçage). On distingue 5
-- types — première brique de l'atome « Assertion » (boussole, pas encore codée) :
--   - objectif   : résultat visé, non directement démontrable (parent de contrôles)
--                  ex. « maintenir un parfait état de propreté microbiologique »
--   - obligation : prestation/action récurrente exigée
--                  ex. « désinfection biquotidienne des sanitaires »
--   - livrable   : document / élément à fournir
--                  ex. « fournir le DOE », « PAQ », « fiches techniques »
--   - controle   : essai / vérification qui PRODUIT une preuve
--                  ex. « essai à la plaque », « prélèvement ATP hebdomadaire »
--   - penalite   : sanction / retenue en cas de manquement
--
-- NULL = non typé (engagements antérieurs à cette migration). Le typage est
-- proposé par l'IA à l'extraction et validable à la curation.

alter table public.engagements
  add column if not exists kind text
  check (kind in ('objectif', 'obligation', 'livrable', 'controle', 'penalite'));

comment on column public.engagements.kind is
  'Nature prescriptive : objectif / obligation / livrable / controle / penalite. Détermine les défauts de preuve et de destination. NULL = non typé.';
