-- Intervention ponctuelle mobile (mig 189).
--
-- A2 : le conducteur cree depuis le mobile une intervention « une fois » (chantier
-- + equipe + date + objet), sans jamais voir le mot « mission ». Elle s'accroche a
-- une mission systeme « Interventions ponctuelles » par chantier (cadence on_demand,
-- invisible du planning — meme mecanique que « Traces libres du site »).
--
-- Comme une intervention n'a pas d'objet/titre propre (son libelle vient du nom de
-- mission), on ajoute UNE seule colonne :
--   - `label` : l'objet court de la ponctuelle (« Reprise etancheite terrasse »).
--     Affichage partout = coalesce(label, nom mission).
-- Le commentaire optionnel reutilise la colonne existante `interventions.notes`.
-- Champ nullable : une intervention recurrente normale le laisse a NULL.

alter table interventions add column if not exists label text;

comment on column interventions.label is
  'Objet court d''une intervention ponctuelle (mig 189). NULL pour une intervention recurrente (le libelle vient alors du nom de mission). Affichage = coalesce(label, mission.name).';
