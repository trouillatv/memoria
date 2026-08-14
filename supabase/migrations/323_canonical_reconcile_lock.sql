-- 323 — P0-2 + P0-3 : verrou de réconciliation + normalisation canonique unique.
--
-- a) Soft lock (P0-2) : canonical_reconcile_started_at marque le début d'une
--    réconciliation en cours. Le pipeline lit ce champ avant de lancer pour
--    éviter deux runs concurrents sur le même rapport.
--    TTL applicatif : 5 minutes. Remis à NULL à la fin (succès ou timeout).
--
-- b) Fonction canonical_normalize_label (P0-3) : réplique exactement la logique
--    TypeScript de normalizeCanonicalLabel() :
--      lower → NFD decompose → strip combining diacritics [U+0300-U+036F]
--      → replace non-alphanum/espace → collapse espaces → trim
--    IMMUTABLE + STRICT → utilisable dans un index fonctionnel.
--    Règle Vincent (2026-08-15) : la même fonction, pas deux définitions
--    indépendantes — une divergence de normalisation recrée le même bug.
--
-- c) Index unique partiel (P0-3) : empêche deux canonical_subject actifs
--    d'avoir le même label normalisé sur le même site.
--    Ne couvre pas merged / auto_archived / split (historique légitime).
--
-- Prérequis : les doublons métier PETRO (deux paires) ont été nettoyés
-- avant l'application de cet index (P0-8). Si des doublons actifs existent
-- encore, la migration échouera proprement — corriger et ré-appliquer.

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS canonical_reconcile_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.site_reports.canonical_reconcile_started_at IS
  'Soft lock : horodatage du début de la réconciliation canonique en cours. '
  'NULL = aucun run actif. Remis à NULL à la fin du run. '
  'TTL applicatif : 5 minutes (un run bloqué libère le verrou après expiration).';

-- ── Fonction de normalisation ───────────────────────────────────────────────
-- Doit rester strictement identique à la fonction TypeScript :
--   lib/db/canonical-subject-resolve.ts :: normalizeCanonicalLabel()
--
-- PostgreSQL 13+ : normalize(text, NFD) est disponible nativement (NFD = mot-clé, pas chaîne).
-- [\x{0300}-\x{036F}]+ : plage Unicode des combining diacritical marks.
-- [^a-z0-9[:space:]] : tout ce qui n'est pas alphanum ASCII ou espace.

CREATE OR REPLACE FUNCTION public.canonical_normalize_label(label text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(normalize(label, NFD)),
          '[\x{0300}-\x{036F}]+', '', 'g'
        ),
        '[^a-z0-9[:space:]]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

COMMENT ON FUNCTION public.canonical_normalize_label(text) IS
  'Normalisation canonique des labels — réplique normalizeCanonicalLabel() TypeScript. '
  'Modification de cette fonction = modification obligatoire de l équivalent TypeScript.';

-- ── Index unique partiel ────────────────────────────────────────────────────
-- N'empêche pas deux subjects avec le MÊME label normalisé d'exister si l un
-- est merged ou auto_archived — c'est l'histoire légitime des fusions et races.
-- N'empêche que deux subjects ACTIFS identiques sur le même site.

CREATE UNIQUE INDEX IF NOT EXISTS canonical_subject_active_normalized_label_uniq
  ON public.canonical_subject (site_id, public.canonical_normalize_label(label))
  WHERE status = 'active';
