-- 431 — PERTINENCE TERRAIN des décisions (Plan de visite, Lot A — GO Vincent 2026-09-XX).
--
-- Audit du contenu du Plan de visite (Guillaume) : une partie des lignes
-- proposées sont des décisions de MÉMOIRE (« on a acté que… » — jamais destinées
-- à être re-vérifiées sur le terrain), affichées à tort comme « Appliquée ? ».
-- Le produit n'avait aucun moyen de distinguer une décision à recontrôler
-- physiquement d'une décision purement actée.
--
-- TRI-ÉTAT explicite, jamais un booléen : NULL = legacy_unknown (décision
-- existante avant ce lot, jamais classifiée — traitée comme AUJOURD'HUI,
-- c'est-à-dire éligible au Plan, cf. lib/db/site-memory-signals.ts). Un booléen
-- avec défaut aurait forcé un choix implicite (true ou false) sur 61 décisions
-- existantes sans preuve individuelle — interdit (doctrine anti-masquage).
--
-- PUREMENT ADDITIF : colonne nullable, aucun backfill, aucune décision
-- existante modifiée par cette migration.
alter table public.site_decisions
  add column if not exists pertinence_terrain text
    check (pertinence_terrain is null or pertinence_terrain in ('a_verifier', 'memoire_seule'));

comment on column public.site_decisions.pertinence_terrain is
  'a_verifier = à recontrôler sur le terrain (éligible Plan de visite) ; memoire_seule = décision actée, jamais re-vérifiée (exclue du Plan) ; NULL = legacy_unknown, jamais auto-converti, traité comme a_verifier tant que non classifié (doctrine anti-masquage, 2026-09).'
