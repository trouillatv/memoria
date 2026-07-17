-- ============================================================
-- 216 — Le moment PRÉVU (Vincent 2026-07-17)
-- ============================================================
-- Le trou du modèle : MemorIA modélise richement le PASSÉ et presque rien du
-- FUTUR. La réunion tenue est un site_report complet ; la réunion à venir est un
-- `next_meeting_at` posé sur un CR — une date orpheline, dédoublonnée à la main
-- par chantier+jour. Et la visite prévue n'existe pas du tout, ce que le code
-- documentait lui-même (lib/db/planning-timeline.ts) :
--
--   « En cours ou terminées, jamais « prévue » : la visite planifiée n'existe pas
--     dans le modèle, et l'inventer serait promettre un rendez-vous que personne
--     n'a pris. »
--
-- C'est pourquoi le Planning ne sait pas répondre à « que va-t-il se passer sur
-- ce chantier ? ».
--
-- ── POURQUOI UNE TABLE, alors que la mig 162 dit « on N'AJOUTE PAS de table » ──
-- La doctrine 162 parle de la visite QUI A EU LIEU : elle est un site_report, et
-- ça ne change pas. Un moment PRÉVU est autre chose — une INTENTION. Un rendez-vous
-- qui n'a pas eu lieu n'est pas le compte-rendu de quelque chose qui n'est pas
-- arrivé. Détourner site_reports pour le porter obligerait à écrire un CR vide
-- pour dire « on se voit jeudi », et à distinguer partout le CR réel du CR-promesse.
-- Les deux doctrines tiennent ensemble : le passé est un report, le futur est un
-- moment prévu, et le premier NAÎT du second.
--
-- ── LA FRONTIÈRE, non négociable ───────────────────────────────────────────────
-- Cette table ne porte QUE les événements futurs SANS objet métier spécialisé.
-- Les interventions, échéances, fermetures, roulements et blocages gardent leur
-- modèle : ils ont déjà un cycle propre (équipe, horaires, preuves, facturation).
-- Ils sont PROJETÉS dans le Planning, jamais migrés ici. Sans cette frontière,
-- site_scheduled_events redevient le fourre-tout qu'on cherche à éviter.

CREATE TABLE IF NOT EXISTS public.site_scheduled_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- Les 5 types SANS objet métier spécialisé. Tout ajout ici doit passer le test :
  -- « cet événement a-t-il déjà une table à lui ? » Si oui, il n'entre pas.
  type                text NOT NULL
    CHECK (type IN ('visit', 'meeting', 'inspection', 'delivery', 'other')),

  -- Cycle COMMUN. Le workflow, lui, est propre à chaque type (cf. plus bas).
  -- 'postponed' est distinct de 'cancelled' : reporté ≠ annulé. Un chantier
  -- reporté trois fois raconte quelque chose qu'une annulation efface.
  status              text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'postponed', 'in_progress', 'completed', 'cancelled')),

  planned_start       timestamptz NOT NULL,
  -- Facultatif : on sait souvent QUAND on passe, rarement pour combien de temps.
  -- Exiger une fin obligerait à en inventer une. (Cf. deduire-avant-de-demander.)
  planned_end         timestamptz,

  title               text,
  -- Champs propres au type, DISCRIMINÉS ET TYPÉS DANS LE CODE (jamais libres) :
  -- cf. ScheduledEventPayload dans lib/db/scheduled-events.ts. La base reste en
  -- jsonb ; c'est l'application qui impose la forme. Un payload libre deviendrait
  -- une poubelle où chaque écran inventerait sa clé.
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── LE LIEN VERS LE PASSÉ ────────────────────────────────────────────────
  -- Le report est la CONSÉQUENCE du moment prévu, jamais l'inverse. Renseigné au
  -- démarrage pour les types qui produisent un CR (visite, réunion, contrôle) ;
  -- il reste NULL pour une livraison, qui se constate sans se raconter.
  linked_report_id    uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,

  -- D'où vient ce rendez-vous : posé à la main, ou repris d'un `next_meeting_at`
  -- annoncé par un CR. Sert la migration douce, et dit au conducteur pourquoi
  -- une réunion est apparue dans son planning sans qu'il l'ait créée.
  created_from        text
    CHECK (created_from IS NULL OR created_from IN ('manual', 'report_next_meeting', 'recurrence')),
  source_report_id    uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,

  cancel_reason       text,
  created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  -- Un moment en cours ou tenu SAIT d'où il vient : sans report lié, la frise
  -- afficherait une visite démarrée qui n'a produit aucune trace. La livraison
  -- est exclue de la règle — elle se complète sans CR.
  CONSTRAINT sse_report_required_when_started CHECK (
    type = 'delivery'
    OR status NOT IN ('in_progress', 'completed')
    OR linked_report_id IS NOT NULL
  )
);

-- Le Planning : « que va-t-il se passer sur ce chantier ? », par fenêtre de temps.
CREATE INDEX IF NOT EXISTS sse_site_start_idx
  ON public.site_scheduled_events (site_id, planned_start)
  WHERE deleted_at IS NULL;
-- Le Planning multi-chantiers (Jour / Semaine / Mois).
CREATE INDEX IF NOT EXISTS sse_org_start_idx
  ON public.site_scheduled_events (organization_id, planned_start)
  WHERE deleted_at IS NULL;
-- « Ce qui attend » : les rendez-vous encore à tenir.
CREATE INDEX IF NOT EXISTS sse_status_idx
  ON public.site_scheduled_events (organization_id, status)
  WHERE deleted_at IS NULL;
-- Retrouver le moment prévu à partir du CR qu'il a produit.
CREATE INDEX IF NOT EXISTS sse_linked_report_idx
  ON public.site_scheduled_events (linked_report_id);

-- Un `next_meeting_at` ne crée QU'UN rendez-vous : plusieurs CR peuvent annoncer
-- la même réunion. Sans cet index, la reprise dédoublerait le planning.
CREATE UNIQUE INDEX IF NOT EXISTS sse_from_report_uidx
  ON public.site_scheduled_events (source_report_id, type)
  WHERE created_from = 'report_next_meeting' AND deleted_at IS NULL;

COMMENT ON TABLE public.site_scheduled_events IS
  'Le moment PRÉVU : les événements futurs d''un chantier SANS objet métier spécialisé (visite, réunion, contrôle, livraison, autre). Les interventions, échéances, fermetures, roulements et blocages gardent leur modèle et sont seulement projetés dans le Planning. Le site_report est la conséquence du moment prévu (linked_report_id), jamais l''inverse.';

-- RLS : service role uniquement, filtre org appliqué dans le code — cohérent avec
-- site_reports / site_actions / site_knowledge_proposals. (Cf. isolation-tenants-fail-closed.)
ALTER TABLE public.site_scheduled_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_scheduled_events
  FOR ALL USING (auth.role() = 'service_role');
