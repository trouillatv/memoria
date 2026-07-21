-- ============================================================
-- 231 — Une proposition SATISFAITE par une concrétisation
-- ============================================================
-- Deux portes mènent au chantier (cf. `lib/db/concretisation-ledger.ts`) :
-- arbitrer une proposition, ou concrétiser le compte-rendu corrigé. Le journal
-- empêchait déjà le doublon d'OBJET. Il restait un mensonge d'ÉCRAN : créer
-- quatre actions par la concrétisation laissait leurs propositions en
-- 'proposed', et le panneau continuait d'annoncer « 7 actions à décider » pour
-- du travail déjà fait. Le clic semblait n'avoir servi à rien.
--
-- POURQUOI PAS 'confirmed' : cet état signifie « un humain a tranché CETTE
-- proposition » — c'est la promotion, et elle pose `reviewed_by`. Une
-- proposition satisfaite par la concrétisation n'a jamais été jugée en tant que
-- telle : l'humain a validé un TEXTE, dont l'objet est né. Les confondre
-- ferait dire au système qu'un arbitrage a eu lieu là où il n'y en a pas eu —
-- exactement ce que « l'IA fait apparaître, l'humain décide ce qui devient
-- vrai » interdit de brouiller.
--
-- POURQUOI PAS UNE SUPPRESSION (Vincent, 2026-07-22) : « je ne supprimerais pas
-- la ligne, je changerais son état — ainsi l'historique reste intact, la
-- provenance reste démontrable, et le panneau ne les compte plus. » Un état est
-- plus riche qu'un effacement.
--
-- Non destructif : on ÉLARGIT le CHECK, aucune donnée existante ne le viole.

-- Le nom réel vient du catalogue, jamais d'une supposition : une base créée à
-- une autre époque peut nommer la contrainte autrement, et un DROP sur un nom
-- deviné ne ferait rien du tout — en silence. (Leçon de la migration 210.)
DO $$
DECLARE
  ck_name text;
BEGIN
  SELECT con.conname INTO ck_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.site_knowledge_proposals'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    AND pg_get_constraintdef(con.oid) ILIKE '%proposed%'
  LIMIT 1;

  IF ck_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.site_knowledge_proposals DROP CONSTRAINT %I', ck_name);
  END IF;
END $$;

ALTER TABLE public.site_knowledge_proposals
  ADD CONSTRAINT site_knowledge_proposals_status_check
  CHECK (status IN ('proposed', 'confirmed', 'fulfilled', 'dismissed', 'superseded'));

COMMENT ON COLUMN public.site_knowledge_proposals.status IS
  'Cycle de vie. proposed = en attente d''un geste humain · confirmed = promue par un arbitrage explicite · fulfilled = satisfaite par la concrétisation du compte-rendu (l''objet existe, mais nul n''a jugé la proposition elle-même) · dismissed = écartée · superseded = remplacée par une lecture plus récente.';
