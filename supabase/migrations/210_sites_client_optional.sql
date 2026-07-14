-- 210 — Un chantier peut exister sans client. Et supprimer un client ne doit
-- plus détruire ses chantiers.
--
-- DEUX corrections indépendantes, dans la même migration parce qu'elles
-- touchent la même contrainte :
--
--   1. USAGE (Guillaume). `client_id NOT NULL` forçait à créer une entité
--      commerciale avant de pouvoir enregistrer un lieu. Une prévisite d'appel
--      d'offres, un repérage, une intervention urgente n'ont pas encore de
--      client. Le contournement observé — un faux client « Interne » — dégrade
--      les données bien plus qu'un `client_id = null` assumé.
--
--   2. INTÉGRITÉ (bug). `ON DELETE CASCADE` signifiait : supprimer un client
--      SUPPRIME tous ses chantiers, et avec eux visites, actions, réserves,
--      photos, mémoire. Personne n'a jamais voulu ça. Cette correction vaut
--      même si le client redevenait un jour obligatoire — la cascade
--      destructive ne doit PAS revenir.
--
-- Aucun backfill : les chantiers existants gardent leur client. Aucune donnée
-- n'est touchée.
--
-- ROLLBACK — à lire avant de l'envisager :
--   `ALTER COLUMN client_id SET NOT NULL` ÉCHOUERA dès qu'un chantier sans
--   client existe. Le retour en arrière suppose donc, dans l'ordre :
--     a) SELECT id, name FROM sites WHERE client_id IS NULL AND deleted_at IS NULL;
--     b) rattacher chacun à un client réel (jamais un client fictif) ;
--     c) alors seulement SET NOT NULL ;
--     d) NE PAS restaurer ON DELETE CASCADE : garder SET NULL.

BEGIN;

-- 1) Le client devient facultatif.
ALTER TABLE public.sites
  ALTER COLUMN client_id DROP NOT NULL;

-- 2) La cascade destructive disparaît. On retrouve le nom RÉEL de la contrainte
--    dans le catalogue plutôt que de le supposer : une base créée à une autre
--    époque peut la nommer autrement, et un DROP CONSTRAINT sur un nom deviné
--    ne ferait rien du tout — en silence.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT con.conname INTO fk_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'sites'
    AND con.contype = 'f'
    AND con.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = rel.oid AND attname = 'client_id')
    ]::smallint[]
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sites DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_client_id_fkey
  FOREIGN KEY (client_id)
  REFERENCES public.clients(id)
  ON DELETE SET NULL;

COMMIT;
