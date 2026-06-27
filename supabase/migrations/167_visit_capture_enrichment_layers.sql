-- 167 — Captures de visite : enrichissement par COUCHES, pas pipeline linéaire
-- (Vincent 2026-06-27, correction du modèle de mig 166 — cf. [[visite-trois-temps]])
--
-- Le pipeline n'est PAS une machine à états linéaire
-- (received→transcribed→summarized→analysed→ready). C'est un ENRICHISSEMENT : la
-- capture reste la même, elle gagne des COUCHES. Chaque couche a son PROPRE statut,
-- INDÉPENDANT — aujourd'hui `transcript_status` ; demain `summary_status`,
-- `analysis_status`, `embedding_status`, `ocr_status`… UNE colonne par couche,
-- ajoutée quand la couche est CÂBLÉE (jamais à vide, cf. [[ai-cost-discipline]]).
-- Conséquence clé : si une couche échoue, les autres ne sont JAMAIS bloquées
-- (« Transcript OK / Résumé KO / Embedding OK » reste un état cohérent).
--
-- processing_stage redevient donc un simple ROLL-UP technique d'orchestration :
--   pending — au moins une couche requise reste à poser (le worker doit traiter)
--   ready   — toutes les couches requises sont posées (rien de plus à pré-calculer)
--   failed  — enrichissement abandonné après retries (l'artefact brut reste intact)
-- JAMAIS montré tel quel au métier : il se mappe en libellés humains grossiers
-- (« En cours d'analyse » / « Prêt à relire ») au débrief, ou rien du tout.

-- Replier les valeurs linéaires de mig 166 sur le roll-up coarse.
update public.visit_capture
  set processing_stage = 'pending'
  where processing_stage in ('received', 'transcribed', 'summarized', 'analysed');

alter table public.visit_capture
  drop constraint if exists visit_capture_processing_stage_check;

alter table public.visit_capture
  add constraint visit_capture_processing_stage_check
  check (processing_stage in ('pending', 'ready', 'failed'));

comment on column public.visit_capture.processing_stage is
  'Roll-up technique d''orchestration de l''enrichissement (mig 167) : pending|ready|failed. PAS une machine à états linéaire — chaque COUCHE d''enrichissement a son propre *_status INDÉPENDANT (transcript_status aujourd''hui ; summary/analysis/embedding/ocr plus tard, UNE colonne par couche câblée). Une couche qui échoue n''en bloque aucune autre. Jamais montré au métier : se mappe en libellés grossiers au débrief, ou rien.';
