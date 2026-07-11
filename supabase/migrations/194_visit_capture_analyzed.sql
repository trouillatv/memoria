-- 194 — « Même pipeline que la réunion » : les suites détectées par l'IA depuis
-- les vocaux/notes d'une VISITE sont désormais PERSISTÉES dans
-- site_report_proposals (le stockage des réunions), au lieu d'être recalculées
-- (et re-payées) à chaque ouverture du Débrief.
--
-- `suite_status` gagne l'état 'analyzed' : la capture TEXTE est passée à l'IA
-- UNE fois, ses propositions vivent leur cycle proposed→accepted/rejected dans
-- site_report_proposals. Corrige au passage un effet de bord : accepter UNE des
-- deux suites d'un même vocal marquait la capture 'done' et faisait disparaître
-- la seconde au rechargement.
--
--   null       → à proposer (pas encore traitée)
--   'analyzed' → passée à l'IA, propositions persistées (captures TEXTE)
--   'done'     → matérialisée/rattachée (suites TAGUÉES — inchangé)
--   'ignored'  → écartée par l'humain (inchangé)
--
-- Rollback : repasser les 'analyzed' à null puis restaurer l'ancien CHECK.

alter table public.visit_capture
  drop constraint if exists visit_capture_suite_status_check;

alter table public.visit_capture
  add constraint visit_capture_suite_status_check
    check (suite_status is null or suite_status in ('done', 'ignored', 'analyzed'));

comment on column public.visit_capture.suite_status is
  'Cycle de la proposition de suite au débrief (migs 183/194) : null=à proposer, analyzed=passée à l''IA (propositions dans site_report_proposals), done=matérialisée/rattachée, ignored=écartée. La décision du tag reste dans triage_intent.';
