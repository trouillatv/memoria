-- =============================================================================
-- 141 — AUDIO DE SECOURS / MULTI-SOURCES (Vincent 2026-06-21, P2a).
-- « Perdre une réunion est infiniment plus grave que manquer un détecteur. »
-- Résilience de la CAPTURE : plusieurs audios par réunion (principal + mémos +
-- appels), fusionnés en un corpus. On RÉUTILISE site_report_attachments (kind=audio,
-- idempotence offline déjà là) — PAS de nouvelle table.
--
-- Par source audio : label, type, durée, transcription propre, POIDS (un mémo de
-- 2 min ne doit pas peser autant qu'un audio d'1h20). + durée estimée de réunion
-- (saisie humaine — les heuristiques mentent) pour l'indice de COUVERTURE.
-- Couverture = « Santé de la mémoire » (qualité de capture), JAMAIS un détecteur
-- chantier, JAMAIS bloquante pour clôturer.
-- =============================================================================

alter table public.site_report_attachments
  add column if not exists label             text,
  add column if not exists type_source       text
    check (type_source in ('audio_meeting', 'voice_note', 'phone_call', 'debrief', 'other')),
  add column if not exists duration_seconds   integer,
  add column if not exists transcript_raw     text,
  add column if not exists transcript_status  text not null default 'none'
    check (transcript_status in ('none', 'pending', 'done', 'failed')),
  add column if not exists transcribed_at     timestamptz,
  add column if not exists source_weight      numeric; -- poids dans le corpus (null → dérivé de la durée)

alter table public.site_reports
  add column if not exists estimated_duration_minutes integer; -- durée PRÉVUE de réunion (saisie)
