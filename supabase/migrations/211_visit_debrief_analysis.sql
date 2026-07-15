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
  add column if not exists debrief_analysis jsonb,
  -- Verrou léger anti double-génération : deux ouvertures simultanées (mobile +
  -- desktop) ne doivent pas lancer deux fois le LLM. Posé avant l'appel, effacé
  -- après ; un bail expiré (voir la couche) est ignoré, jamais de blocage définitif.
  add column if not exists debrief_generating_at timestamptz;

comment on column public.site_reports.debrief_analysis is
  'Résultat persisté du débrief IA « Ce que MemorIA a retenu » (résumé/décisions/actions/points + provider/model/generated_at/corpus_hash). Écrit à la première ouverture du débrief (lazy-once + cache) ; NULL = pas encore analysé. Les actions y sont des PROPOSITIONS IA — jamais des site_actions validées.';

comment on column public.site_reports.debrief_generating_at is
  'Bail de génération du débrief IA (anti double-appel concurrent). NULL = libre.';
