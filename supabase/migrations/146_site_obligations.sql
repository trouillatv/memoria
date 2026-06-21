-- Obligations chantier (2026-06-21) — le nouvel objet métier PRESCRIPTIF.
--
-- Action / Réserve / Décision / Sujet sont DESCRIPTIFS : ils naissent de ce qui
-- s'est passé. L'OBLIGATION est PRESCRIPTIVE : elle doit exister dès le démarrage,
-- et c'est son ABSENCE qui est le signal (Guillaume : « si le mec pense pas au
-- journal photo, il y en a pas »). On ne peut pas détecter un oubli avec un objet
-- qui naît de l'événement ; il faut un objet qui sait ce qui DEVRAIT être là.
--
-- DOCTRINE (cadrage validé avec Vincent) :
--   - Bibliothèque CURÉE (obligation_template), pas de parsing CCTP, zéro IA.
--   - Santé DÉRIVÉE (ok | négligée), déterministe, comme les insights du sujet.
--   - Injection au démarrage : l'IA PROPOSE la liste standard, l'HUMAIN valide
--     (status non_applicable = écarter, réversible).
--   - responsible_role = DESCRIPTIF (« entreprise »), jamais une note d'acteur.
--   - Pont subject_id : une obligation peut pointer son sujet vivant (nourrit la
--     recherche par sujet à venir).
-- NO RLS (server actions via admin client, comme les autres tables site_*).

-- ── Catalogue : la connaissance métier (standard VRD ; extensible par org) ──
CREATE TABLE IF NOT EXISTS public.obligation_template (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = modèle SYSTÈME (livré, partagé) ; sinon = ajout propre à une organisation.
  organization_id    uuid,
  code               text NOT NULL,          -- 'doe', 'journal_photo', 'dict'…
  label              text NOT NULL,
  default_responsible_role text NOT NULL DEFAULT 'entreprise',
  -- Quand elle APPARAÎT.
  trigger            text NOT NULL DEFAULT 'kickoff'
    CHECK (trigger IN ('kickoff', 'phase', 'manual')),
  phase_key          text,                    -- ex. 'enrobes', 'remblais' (si trigger=phase)
  -- Quand elle DISPARAÎT.
  closure            text NOT NULL DEFAULT 'on_artifact'
    CHECK (closure IN ('on_artifact', 'at_reception', 'recurring_until_reception')),
  -- Comment elle est VÉRIFIÉE (pilote la santé dérivée).
  verification_kind  text NOT NULL DEFAULT 'document'
    CHECK (verification_kind IN ('document', 'photo_journal', 'control_event')),
  verification_param jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {neglect_days:30} | {staleness_days:21}
  -- Thématiques chantier concernées (aide au ciblage de la proposition au démarrage).
  themes             text[] NOT NULL DEFAULT '{}',
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         int NOT NULL DEFAULT 100,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS obligation_template_org_idx ON public.obligation_template (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS obligation_template_system_code_idx
  ON public.obligation_template (code) WHERE organization_id IS NULL;

-- ── Instance : l'obligation d'UN chantier ──
CREATE TABLE IF NOT EXISTS public.site_obligation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id    uuid,
  template_id        uuid REFERENCES public.obligation_template(id) ON DELETE SET NULL,
  label              text NOT NULL,
  responsible_role   text NOT NULL DEFAULT 'entreprise',
  responsible_contact_id uuid REFERENCES public.company_contacts(id) ON DELETE SET NULL,
  -- Cycle de vie. negligée n'est PAS un statut : c'est une SANTÉ dérivée.
  status             text NOT NULL DEFAULT 'a_produire'
    CHECK (status IN ('a_produire', 'en_cours', 'satisfaite', 'non_applicable')),
  -- Recopiés du template à l'instanciation (l'instance reste lisible si le modèle bouge).
  trigger            text NOT NULL DEFAULT 'kickoff',
  phase_key          text,
  closure            text NOT NULL DEFAULT 'on_artifact',
  verification_kind  text NOT NULL DEFAULT 'document',
  verification_param jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Pont vers le sujet vivant (nourrit la recherche par sujet à venir).
  subject_id         uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  satisfied_at       timestamptz,
  satisfied_note     text,
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Une même obligation (modèle) n'est instanciée qu'une fois par chantier.
  CONSTRAINT site_obligation_unique_template UNIQUE (site_id, template_id)
);
CREATE INDEX IF NOT EXISTS site_obligation_site_idx ON public.site_obligation (site_id, status);
CREATE INDEX IF NOT EXISTS site_obligation_subject_idx ON public.site_obligation (subject_id);

COMMENT ON TABLE public.obligation_template IS
  'Catalogue curé d''obligations chantier (standard VRD livré + ajouts org). PAS de parsing CCTP : la bibliothèque EST la connaissance métier.';
COMMENT ON TABLE public.site_obligation IS
  'Obligation PRESCRIPTIVE d''un chantier : doit exister dès le démarrage, son absence/négligence est le signal. Santé (ok|négligée) DÉRIVÉE, non stockée.';
COMMENT ON COLUMN public.site_obligation.status IS
  'a_produire | en_cours | satisfaite | non_applicable (écartée par l''humain). « négligée » = santé dérivée, pas un statut.';

-- ── Seed : la bibliothèque VRD standard (modèles SYSTÈME, organization_id NULL) ──
INSERT INTO public.obligation_template (code, label, default_responsible_role, trigger, phase_key, closure, verification_kind, verification_param, themes, sort_order)
VALUES
  ('doe',                'DOE (Dossier des Ouvrages Exécutés)', 'entreprise', 'kickoff', NULL,       'at_reception',              'document',      '{"neglect_days":30}'::jsonb, '{terrassement,assainissement,voirie}', 10),
  ('journal_photo',      'Journal photo de chantier',           'MOE',        'kickoff', NULL,       'recurring_until_reception', 'photo_journal', '{"staleness_days":21}'::jsonb, '{terrassement,assainissement,voirie}', 20),
  ('dict',               'DICT (Déclaration d''Intention de Commencement de Travaux)', 'entreprise', 'kickoff', NULL, 'on_artifact', 'document', '{"neglect_days":14}'::jsonb, '{terrassement,assainissement,voirie}', 30),
  ('paq',                'PAQ (Plan d''Assurance Qualité)',     'entreprise', 'kickoff', NULL,       'on_artifact',               'document',      '{"neglect_days":30}'::jsonb, '{terrassement,assainissement,voirie}', 40),
  ('recolement',         'Plans de récolement',                 'entreprise', 'kickoff', NULL,       'at_reception',              'document',      '{"neglect_days":30}'::jsonb, '{assainissement,voirie}',              50),
  ('fiches_techniques',  'Fiches techniques matériaux (avant mise en œuvre)', 'entreprise', 'phase', NULL, 'on_artifact',          'document',      '{"neglect_days":30}'::jsonb, '{terrassement,assainissement,voirie}', 60),
  ('essais_plaque',      'Essais à la plaque (compactage)',     'entreprise', 'phase',   'remblais', 'on_artifact',               'control_event', '{"neglect_days":21}'::jsonb, '{terrassement,voirie}',                70),
  ('controles_enrobes',  'Contrôles enrobés (température / gamma)', 'entreprise', 'phase', 'enrobes', 'on_artifact',              'control_event', '{"neglect_days":14}'::jsonb, '{voirie}',                             80)
ON CONFLICT DO NOTHING;
