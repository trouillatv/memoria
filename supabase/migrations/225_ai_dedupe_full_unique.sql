-- Migration 225 — La dédup des outcomes IA doit être INFÉRABLE par ON CONFLICT.
--
-- Défaut trouvé PAR EXÉCUTION contre la vraie base (jamais par les tests, dont le
-- client est mocké) : la mig 224 posait un index unique PARTIEL
-- (`where ai_dedupe_key is not null`), or Postgres ne peut inférer un index
-- partiel pour `ON CONFLICT (ai_dedupe_key)` que si la clause répète le prédicat
-- — ce que PostgREST (`upsert(..., { onConflict })`) ne fait pas.
--
-- Conséquence mesurée (42P10) : CHAQUE insert du contrat échouait, même sans clé
-- de dédup, l'erreur était avalée par le best-effort… et AUCUN événement n'aurait
-- jamais été écrit. Un vert silencieux — le même motif que le tripwire cassé du
-- lot précédent : un garde qui ne tourne pas ressemble à un garde qui ne trouve
-- rien.
--
-- Correction : index unique PLEIN. Postgres autorise plusieurs NULLs dans un
-- index unique (comportement standard NULLS DISTINCT) : les lignes sans clé de
-- dédup s'insèrent librement, les clés renseignées restent uniques, et
-- l'inférence ON CONFLICT fonctionne.
--
-- Idempotente. Rollback : recréer l'index partiel de la mig 224.

drop index if exists public.usage_events_ai_dedupe_uq;

create unique index if not exists usage_events_ai_dedupe_uq
  on public.usage_events (ai_dedupe_key);
