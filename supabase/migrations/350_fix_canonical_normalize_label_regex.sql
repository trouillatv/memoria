-- 350 — Correctif : canonical_normalize_label() utilisait une syntaxe d'echappement
-- Unicode invalide en PostgreSQL.
--
-- Bug (migration 323) : '[\x{0300}-\x{036F}]+' est la forme PCRE/Perl des combining
-- diacritical marks. PostgreSQL (moteur ARE) ne supporte pas '\x{hhhh}' - seulement
-- '\xhh' (1-2 chiffres hex) ou '\uwxyz' (exactement 4 chiffres hex, sans accolades).
-- Consequence : la fonction levait 2201B (invalid regular expression) sur TOUTE
-- entree, sans exception - cassant tout INSERT/UPDATE d'un canonical_subject actif
-- (status='active' par defaut), car l'index unique partiel
-- canonical_subject_active_normalized_label_uniq evalue cette fonction en index
-- maintenance.
--
-- Correctif : remplacer '[\x{0300}-\x{036F}]+' par '[\u0300-\u036F]+' - meme
-- plage Unicode, syntaxe d'echappement valide pour PostgreSQL (\uwxyz = exactement
-- 4 chiffres hex, sans accolades). Aucune autre modification : ni l'index, ni le
-- reste de la chaine de normalisation.
--
-- Verifie en base reelle avant application (Hello World, Echeance, Reserve, texte
-- sans accent, deux labels equivalents avec casse/espaces differents - tous
-- conformes a normalizeCanonicalLabel() TypeScript).

CREATE OR REPLACE FUNCTION public.canonical_normalize_label(label text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(normalize(label, NFD)),
          '[\u0300-\u036F]+', '', 'g'
        ),
        '[^a-z0-9[:space:]]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

COMMENT ON FUNCTION public.canonical_normalize_label(text) IS
  'Normalisation canonique des labels - replique normalizeCanonicalLabel() TypeScript. '
  'Modification de cette fonction = modification obligatoire de l equivalent TypeScript. '
  'Correctif 350 (2026-08-25) : \x{...} PCRE invalide en Postgres -> \u.... (4 hex, sans accolades).';
