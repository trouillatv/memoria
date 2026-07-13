-- 198 — L'identité d'une occurrence : deux NULL, c'est le MÊME créneau.
--
-- LE BUG (prouvé par tests/lib/occurrence-identity.test.ts, qui ÉCHOUAIT avant
-- cette migration) : l'index unique de la mig 021 était en NULLS DISTINCT (le
-- défaut Postgres). Deux lignes (template, date, NULL) étaient donc TOUTES DEUX
-- acceptées — or `slot` EST null pour un rythme sans heure et sans créneau.
--
-- Le CODE, lui, tient déjà le contrat inverse : `occurrenceKey`
-- (lib/planning/projection.ts) réduit un slot null à '∅' et traite donc deux
-- NULL comme UNE SEULE identité. La base et le code DIVERGEAIENT.
-- Cette migration ne change aucun contrat : elle ALIGNE LA BASE SUR CE QUE LE
-- CODE CROIT DÉJÀ. La clé reste exactement (template_id, scheduled_for, slot).
--
-- Vérifié en base AVANT écriture (2026-07-13, PG 17.6) :
--   • 0 doublon sur la clé, tous cas confondus ;
--   • 0 doublon avec slot NULL ;
--   • 0 intervention issue d'un rythme, 0 rythme actif.
-- La reconstruction de l'index est donc SANS RISQUE et ne peut échouer sur
-- aucune donnée. C'est le bon moment : elle serait douloureuse une fois des
-- rythmes réels en place.
--
-- NULLS NOT DISTINCT : supporté depuis PostgreSQL 15 (base en 17.6).
-- Idempotente (rejouée par db-reproducibility.yml).
-- Rollback : recréer l'index sans `nulls not distinct`.

drop index if exists public.idx_interventions_template_unique;

create unique index if not exists idx_interventions_template_unique
  on public.interventions (template_id, scheduled_for, slot)
  nulls not distinct
  where template_id is not null;

comment on index public.idx_interventions_template_unique is
  'Identité d''une occurrence (mig 198) : template_id + scheduled_for + slot, deux NULL = le MÊME créneau. Aligne la base sur occurrenceKey (lib/planning/projection.ts).';
