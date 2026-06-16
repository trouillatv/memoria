-- =============================================================================
-- 116 — S2-C : libère intervention_anomalies.category (enum PG → text).
--
-- Pourquoi : le CATALOGUE par métier (org_catalog, mig 115) doit pouvoir piloter
-- les catégories d'anomalie selon le métier de l'org (BTP : « malfaçon »,
-- « réserve », « eau/réseau » ; maintenance : « panne »…), pas seulement l'enum
-- figé hérité du nettoyage. Tant que la colonne est un enum PG, toute clé hors
-- enum est rejetée à l'INSERT → le catalogue ne peut pas réellement piloter la
-- création.
--
-- Non destructif : les valeurs existantes (eau_coupee, danger_securite, …)
-- restent IDENTIQUES, juste stockées en text. Le type enum `anomaly_category`
-- reste défini (historique) mais n'est plus la contrainte de la colonne. La
-- validation des clés se fait désormais côté applicatif contre le catalogue.
-- =============================================================================

alter table public.intervention_anomalies
  alter column category type text using category::text;
