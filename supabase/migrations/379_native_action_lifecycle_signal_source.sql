-- Migration 379 : object_state_occurrence_signal.source — provenance native
--
-- P1-4A (correctif). Le cycle de vie NATIF (emitNativeActionLifecycleSignal) écrit
-- source='native_action_event' pour distinguer une clôture/réouverture EXPLICITE par
-- l'utilisateur (preuve de premier ordre, décision d'équipe) du verdict documentaire
-- (source='document_status') et de l'observation IA (source='llm').
--
-- Le CHECK de la migration 349 n'autorisait que ('document_status','llm') : en base
-- réelle, l'écriture native était donc REJETÉE (violation de contrainte), silencieusement
-- avalée par le best-effort du writer → la clôture native n'atteignait jamais le CBO.
-- Cette migration additive débloque le canal natif sans changer aucune autre sémantique.
--
-- Additive et sûre : toutes les lignes existantes portent 'document_status' ou 'llm',
-- toujours valides. Idempotente (DROP IF EXISTS + ADD), même patron que la mig 317.

ALTER TABLE public.object_state_occurrence_signal
  DROP CONSTRAINT IF EXISTS object_state_occurrence_signal_source_check;

ALTER TABLE public.object_state_occurrence_signal
  ADD CONSTRAINT object_state_occurrence_signal_source_check
  CHECK (source IN ('document_status', 'llm', 'native_action_event'));
