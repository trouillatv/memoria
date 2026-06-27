-- 166 — Pipeline de traitement des captures de visite (Vincent 2026-06-27)
--
-- Une capture vocale ne BLOQUE jamais : à l'upload elle est déposée brute, puis
-- ENRICHIE en arrière-plan (transcription, plus tard résumé / analyse / suggestions).
-- La visite n'est plus une collecte de fichiers : c'est un PIPELINE de production
-- d'information — chaque capture s'enrichit toute seule avant le débrief.
--
-- DOCTRINE DE DÉCLENCHEMENT (cf. [[visite-trois-temps]], pattern éprouvé des AO) :
-- le CLIENT ne traite jamais. Il peut seulement DÉCLENCHER la route worker
-- (/api/visit-captures/process) qui fait le travail DANS la requête HTTP — fiable
-- sur Vercel, contrairement à after() qui est COUPÉ. La VÉRITÉ est en base
-- (processing_stage + transcript_status). Si le client se ferme avant de
-- déclencher (réseau coupé, navigateur tué), la capture reste en stage non
-- terminal → un CRON QUOTIDIEN la rattrape. Aucune dépendance à after(), aucune
-- nouvelle infra (pas de QStash / pg_cron / Vercel Pro) tant que l'usage terrain
-- n'a pas prouvé le besoin d'un worker sub-minute (cf. [[ai-cost-discipline]]).
--
-- ÉTAPES INDÉPENDANTES (résilience) : si l'analyse IA tombe plus tard, l'audio et
-- le transcript restent acquis. Le stage track la POSITION dans le pipeline ;
-- transcript_status garde le détail de la seule étape câblée aujourd'hui.

alter table public.visit_capture
  -- Position dans le pipeline d'enrichissement. Vocabulaire complet posé
  -- volontairement ; seul 'received' → 'ready' (via transcription) est CÂBLÉ
  -- aujourd'hui. 'summarized'/'analysed' attendent le débrief IA (gated usage).
  --   received   — déposée, en attente d'enrichissement de fond
  --   transcribed— vocal transcrit
  --   summarized — résumé prêt (futur)
  --   analysed   — rapprochements / suggestions prêts (futur)
  --   ready      — prête pour le débrief (rien de plus à pré-calculer)
  --   failed     — enrichissement abandonné (l'artefact brut reste intact)
  add column if not exists processing_stage text not null default 'ready'
    check (processing_stage in (
      'received', 'transcribed', 'summarized', 'analysed', 'ready', 'failed'
    )),
  -- Dernier message d'erreur d'enrichissement (diagnostic ; jamais montré au terrain).
  add column if not exists processing_error text,
  -- Nombre de tentatives d'enrichissement (backoff / abandon par le cron).
  add column if not exists processing_attempts integer not null default 0,
  -- Horodatage de la dernière tentative (détection des « coincés » par le cron).
  add column if not exists processing_at timestamptz;

-- Le worker (route + cron) cherche les captures à enrichir : stage non terminal.
create index if not exists visit_capture_pending_idx
  on public.visit_capture (processing_stage, processing_at)
  where processing_stage not in ('ready', 'failed');

comment on column public.visit_capture.processing_stage is
  'Position dans le pipeline d''enrichissement de fond (mig 166). received → transcribed → summarized → analysed → ready (+failed). Seul received→ready (transcription) est câblé ; le reste attend le débrief IA. La vérité de l''avancement est ICI, pas dans le client : le client ne fait que déclencher la route worker, le cron quotidien rattrape les coincés.';
