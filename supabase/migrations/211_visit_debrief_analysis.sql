-- Résumé IA du débrief, PERSISTÉ sur la visite (« Ce que MemorIA a retenu »).
--
-- Aujourd'hui l'analyse IA du débrief est calculée puis JETÉE si l'humain ne
-- valide pas ; l'utilisateur retombe sur la transcription brute et croit que
-- MemorIA fait de la dictée. On persiste désormais le résultat pour le REJOUER
-- sans rappeler le LLM à chaque affichage (lazy-once + cache).
--
-- Le JSON porte : summary, decisions, actions, watchpoints (+ champs de contexte
-- pour la validation), provider, model, generated_at, et transcript_hash.
-- transcript_hash invalide proprement le cache : si la transcription change
-- (Guillaume corrige un passage), hash différent → l'analyse est régénérée.
--
-- Additif et nullable : aucune visite existante impactée. NULL = pas encore
-- analysé. AUCUN modèle IA n'est touché — on ne fait que ranger le résultat.

alter table public.site_reports
  add column if not exists debrief_analysis jsonb;

comment on column public.site_reports.debrief_analysis is
  'Résultat persisté du débrief IA « Ce que MemorIA a retenu » (résumé/décisions/actions/points + provider/model/generated_at/transcript_hash). Écrit à la première ouverture du débrief (lazy-once + cache) ; NULL = pas encore analysé.';
