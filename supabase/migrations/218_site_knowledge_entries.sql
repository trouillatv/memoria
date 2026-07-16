-- ============================================================
-- 218 — La mémoire du chantier (Vincent 2026-07-17)
-- ============================================================
-- Le 6ᵉ et dernier promoteur. « knowledge » était le seul type sans destination
-- métier : on ne pouvait pas confirmer une information. C'est l'objet qui manquait
-- pour que « Ce que le chantier sait » puisse enfin contenir quelque chose.
--
-- ── L'ARBITRAGE (Vincent) ──────────────────────────────────────────────────
-- Une phrase peut être vraie dans le contexte d'une visite sans être durable.
-- « L'avancement n'est pas encore défini » est utile aujourd'hui et faux demain ;
-- « Vincent Milon est l'interlocuteur PAVE » reste vrai jusqu'à correction. Les
-- confondre ferait accumuler des états périmés présentés comme du savoir.
--
--   current_information → vraie MAINTENANT, périssable, garde sa date d'observation
--   durable_knowledge   → réutilisable aux prochaines visites, vraie jusqu'à correction
--
-- C'est l'HUMAIN qui tranche la nature au moment de confirmer — jamais l'IA.
-- Demander au modèle « durable ou périssable ? » serait lui faire porter un
-- jugement qu'il raterait silencieusement, exactement comme les 3 points de
-- vigilance perdus par un mot mal orthographié.
--
-- ── observed_pattern : DÉCLARÉ, PAS ENCORE ALIMENTÉ ────────────────────────
-- Une habitude exige plusieurs observations INDÉPENDANTES (« les accès sont
-- arrivés tard » × 3 visites). La proposer au premier passage transformerait une
-- circonstance ponctuelle en règle générale. Le kind existe pour que la table
-- n'ait pas à être migrée quand le sprint multi-visites arrivera ; AUCUN chemin
-- d'écriture ne le produit aujourd'hui, et la promotion l'interdit.

CREATE TABLE IF NOT EXISTS public.site_knowledge_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- La nature, choisie par l'humain à la confirmation.
  kind                  text NOT NULL
    CHECK (kind IN ('current_information', 'durable_knowledge', 'observed_pattern')),
  -- 'superseded' : une information remplacée par une plus récente. Elle ne
  -- disparaît pas — elle sort de la lecture courante. (Cf. mig 212.)
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'archived')),

  title                 text NOT NULL,
  body                  text,

  -- PROVENANCE : « Mentionné dans la visite du 15 juillet · mémo vocal n°2 ».
  source_report_id      uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,
  source_capture_ids    uuid[] NOT NULL DEFAULT '{}',

  -- La date d'OBSERVATION : une information actuelle sans elle serait intemporelle,
  -- donc impossible à périmer. Défaut = la confirmation.
  valid_from            timestamptz NOT NULL DEFAULT now(),
  -- Renseignée quand l'information cesse d'être vraie. JAMAIS calculée : le temps
  -- signale qu'il faut réexaminer, il ne périme rien tout seul.
  valid_until           timestamptz,
  -- Le chaînage : cette entrée remplace celle-ci. On ne devine pas le lien par
  -- ressemblance de titre — ce serait inventer une continuité.
  supersedes_id         uuid REFERENCES public.site_knowledge_entries(id) ON DELETE SET NULL,

  -- Une confirmation est un ACTE : il a un auteur et une heure.
  confirmed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- « Ce que le chantier sait » — la requête de la Mémoire.
CREATE INDEX IF NOT EXISTS ske_site_kind_status_idx
  ON public.site_knowledge_entries (site_id, kind, status)
  WHERE deleted_at IS NULL;
-- Ce qu'une visite a laissé dans la mémoire.
CREATE INDEX IF NOT EXISTS ske_report_idx
  ON public.site_knowledge_entries (source_report_id);

COMMENT ON TABLE public.site_knowledge_entries IS
  'La mémoire du chantier : ce qu''un HUMAIN a confirmé depuis les propositions (kind=knowledge). current_information = vraie maintenant, périssable, datée ; durable_knowledge = réutilisable jusqu''à correction explicite ; observed_pattern = habitude, DÉCLARÉ mais non alimenté (exige plusieurs visites — sprint dédié). La nature est choisie par l''humain, jamais déduite par l''IA.';

ALTER TABLE public.site_knowledge_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_knowledge_entries
  FOR ALL USING (auth.role() = 'service_role');
