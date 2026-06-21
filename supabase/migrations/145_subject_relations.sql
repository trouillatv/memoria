-- Dépendances entre sujets (2026-06-21) — « A BLOQUE B ».
--
-- Gate métier franchi : Guillaume répond du tac au tac « DOE bloque réception et
-- clôture · Réserve 12 bloque DOE ». Les dépendances existent dans sa tête → on
-- les rend explicites. Une seule relation DIRIGÉE : le bloqueur bloque le bloqué.
-- « A dépend de B » / « A attend B » NE sont PAS stockés : ce sont des lectures de
-- la même arête vue de l'autre côté.
--
-- DOCTRINE (verrouillée avec Vincent) :
--   - UN seul type : BLOQUE. Pas de « lié » (poubelle sémantique en 6 mois).
--   - `reason` OBLIGATOIRE : « pourquoi A bloque B » — c'est ce qui rend la
--     dépendance exploitable (« plans CFO manquants ») plutôt que décorative.
--   - `importance` critique|normal : tous les blocages ne se valent pas
--     (DOE→réception = critique ; DOE→archivage = normal). PAS un score.
--   - Acte HUMAIN : created_by renseigné par le serveur. L'IA peut SUGGÉRER une
--     dépendance, elle ne la CRÉE jamais.
--   - Pas de cascade, pas de graphe, pas de Gantt, pas d'entreprise ici.
-- NO RLS (server actions via admin client, comme les autres tables site_*).

CREATE TABLE IF NOT EXISTS public.subject_relation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid,

  -- A BLOQUE B : from = le bloqueur, to = le bloqué.
  from_subject_id  uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  to_subject_id    uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,

  -- POURQUOI A bloque B (obligatoire). Ex. « plans CFO manquants ».
  reason           text NOT NULL,

  -- Tous les blocages ne se valent pas. critique = compte vraiment ; normal = secondaire.
  importance       text NOT NULL DEFAULT 'normal'
    CHECK (importance IN ('critique', 'normal')),

  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Un sujet ne se bloque pas lui-même ; une seule arête par paire dirigée.
  CONSTRAINT subject_relation_no_self CHECK (from_subject_id <> to_subject_id),
  CONSTRAINT subject_relation_unique  UNIQUE (from_subject_id, to_subject_id)
);

CREATE INDEX IF NOT EXISTS subject_relation_from_idx ON public.subject_relation (from_subject_id);
CREATE INDEX IF NOT EXISTS subject_relation_to_idx   ON public.subject_relation (to_subject_id);

COMMENT ON TABLE public.subject_relation IS
  'Dépendances dirigées entre sujets : from BLOQUE to. « dépend de »/« attend » = la même arête lue à l''envers. reason obligatoire, importance critique|normal, acte humain.';
COMMENT ON COLUMN public.subject_relation.from_subject_id IS 'Le sujet BLOQUEUR (A dans « A bloque B »).';
COMMENT ON COLUMN public.subject_relation.to_subject_id IS 'Le sujet BLOQUÉ (B dans « A bloque B »).';
COMMENT ON COLUMN public.subject_relation.reason IS 'Pourquoi A bloque B (obligatoire) — rend la dépendance exploitable.';
COMMENT ON COLUMN public.subject_relation.importance IS 'critique = blocage qui compte vraiment ; normal = secondaire. Pas un score.';
