-- Suppression d'une visite non concluante (mig 190).
--
-- Retour terrain : une visite terminee mais sans interet (test, doublon, rien de
-- releve) continue de trainer dans « Reprendre mon travail / Tri restant » et dans
-- la liste des visites. Le conducteur doit pouvoir la SUPPRIMER.
--
-- Soft-delete (pattern maison, comme sites/missions/teams) : reversible, sans
-- risque de contrainte FK ni d'orphelins. `deleted_at` non-null = visite ecartee ;
-- toutes les vues qui listent/ouvrent des visites filtrent `deleted_at is null`.

alter table site_reports add column if not exists deleted_at timestamptz;

comment on column site_reports.deleted_at is
  'Soft-delete d''une visite non concluante (mig 190). NULL = active. Les vues visite filtrent deleted_at IS NULL.';
