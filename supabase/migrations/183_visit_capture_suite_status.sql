-- 183 — Matérialisation des SUITES au débrief.
--
-- Une capture taguée ✅ Action / ⚠️ Réserve (écran 2) est une DÉCISION, pas encore
-- un objet. Au débrief, MemorIA PROPOSE de la matérialiser en vrai objet (au
-- niveau CHANTIER : site_actions / site_reserve) ; l'humain valide, modifie ou
-- ignore. RIEN n'est créé sans validation.
--
-- `suite_status` porte le cycle de vie de CETTE proposition, pour ne pas la
-- reproposer indéfiniment :
--   null      → à proposer (capture taguée, pas encore traitée)
--   'done'    → une action/réserve a été créée (ou rattachée à une existante)
--   'ignored' → l'humain a écarté la suite (on ne repropose plus)
--
-- `source_capture_id` sur les objets = traçabilité (« d'où vient cette action ? »)
-- et dédup par source.

alter table public.visit_capture
  add column if not exists suite_status text
    check (suite_status is null or suite_status in ('done', 'ignored'));

comment on column public.visit_capture.suite_status is
  'Cycle de la proposition de suite au débrief (mig 183) : null=à proposer, done=matérialisée/rattachée, ignored=écartée. La décision du tag reste dans triage_intent.';

alter table public.site_actions
  add column if not exists source_capture_id uuid;

alter table public.site_reserve
  add column if not exists source_capture_id uuid;
