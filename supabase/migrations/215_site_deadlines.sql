-- Échéances chantier (2026-07-17) — le 6ᵉ objet métier.
--
-- DOCTRINE (cadrage Vincent) : une échéance existe UNIQUEMENT s'il y a une notion
-- de TEMPS. Cette notion prend trois formes :
--   · une date absolue    — « le 28 juillet »
--   · une date relative   — « sous une dizaine de jours »
--   · une dépendance      — « avant le démarrage », « après la visite PAVE »
-- S'il n'y a AUCUNE notion temporelle (« il faudra prévoir la formation »), ce
-- n'est pas une échéance : c'est une action. On ne dédouble pas le travail.
--
-- LA COLONNE QUI PORTE LA DOCTRINE : `constraint_text`. Quand le débrief dit
-- « sous dix jours », MemorIA ne calcule PAS le 27 juillet — elle garde la phrase.
-- Convertir un délai en date, ce serait faire dire au chantier une précision que
-- personne n'a donnée ; le jour où elle est fausse, c'est toute la mémoire qu'on
-- cesse de croire. L'humain tranche, la contrainte reste mémorisée.
--
-- ON NE BLOQUE JAMAIS LA CONFIRMATION : Guillaume confirme qu'il s'agit bien d'une
-- échéance, elle naît « à planifier », et vit dans une section dédiée du Planning
-- tant qu'elle n'a pas de date. Dès qu'une date arrive, elle bascule dans le
-- planning chronologique. `due_date` NULL est donc un ÉTAT VALIDE, pas un trou.
--
-- NO RLS (server actions via admin client, comme les autres tables site_*).

CREATE TABLE IF NOT EXISTS public.site_deadlines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid,
  site_id          uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- La visite d'où elle vient. Le lien de provenance, jamais une fenêtre de temps.
  report_id        uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,

  -- CE QUI doit arriver. « Poser le coffret électrique ». Autoportant.
  title            text NOT NULL,
  -- La contrainte DITE, telle quelle. Vide si une date nette a été donnée.
  constraint_text  text,
  -- Le QUAND, quand on le sait. NULL = à planifier (état valide).
  due_date         date,

  --   to_plan   : confirmée, sans date — elle attend une planification.
  --   planned   : datée, elle vit dans le planning chronologique.
  --   done      : arrivée.
  --   cancelled : abandonnée (décision humaine, jamais un oubli).
  status           text NOT NULL DEFAULT 'to_plan'
                   CHECK (status IN ('to_plan', 'planned', 'done', 'cancelled')),

  created_from     text,          -- 'visit_debrief_ai' | 'manual'
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Le planning lit « ce qui approche » : on trie par date, en gardant les non datées.
CREATE INDEX IF NOT EXISTS site_deadlines_site_idx
  ON public.site_deadlines (site_id, status, due_date)
  WHERE deleted_at IS NULL;

-- « À planifier » est une VUE fréquente : ce qui attend une décision humaine.
CREATE INDEX IF NOT EXISTS site_deadlines_to_plan_idx
  ON public.site_deadlines (site_id)
  WHERE deleted_at IS NULL AND status = 'to_plan';

COMMENT ON COLUMN public.site_deadlines.constraint_text IS
  'La contrainte de temps DITE (« Avant le démarrage »). Jamais convertie en date : MemorIA ne devine pas une information qu''elle ne possède pas.';
COMMENT ON COLUMN public.site_deadlines.due_date IS
  'NULL = à planifier. État valide : la confirmation n''est jamais bloquée par l''absence de date.';
