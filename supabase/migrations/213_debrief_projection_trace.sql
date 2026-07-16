-- La projection métier laisse une TRACE : elle ne peut plus échouer en silence.
--
-- Le problème observé (Lycée PETRO ATTITI, 16/07/2026) : une synthèse existait,
-- l'IA avait extrait 3 actions, 3 échéances, 4 intervenants, 2 « à savoir » — et
-- AUCUNE proposition n'était en base. La projection était appelée en
-- `.catch(() => {})` : si elle échoue (ou n'a jamais tourné), la synthèse
-- s'affiche, la connaissance disparaît, et le chantier paraît VIDE.
--
-- C'est le pire scénario : l'utilisateur conclut « MemorIA n'a rien compris »,
-- alors que MemorIA avait compris et qu'une projection avait échoué.
--
-- La projection n'est pas un « best effort » : c'est un élément métier. Si elle
-- échoue, on le sait, on le loggue, on peut le montrer.
--
-- Trois états, lisibles sans deviner :
--   projected_at NULL + error NULL  → jamais projetée (synthèse d'avant la
--                                     projection : se répare à la prochaine ouverture) ;
--   projected_at NON NULL           → projetée, tout va bien ;
--   error NON NULL                  → projection en échec, avec sa raison.
--
-- Additif et nullable : aucune visite existante impactée.

alter table public.site_reports
  -- Quand la connaissance de cette synthèse a été projetée en propositions.
  add column if not exists debrief_projected_at timestamptz,
  -- Pourquoi la projection a échoué (NULL = pas d'échec). Message technique :
  -- il sert au diagnostic, jamais à l'affichage brut pour un conducteur.
  add column if not exists debrief_projection_error text;

comment on column public.site_reports.debrief_projected_at is
  'Date de projection de la synthèse en propositions métier. NULL + error NULL = jamais projetée.';
comment on column public.site_reports.debrief_projection_error is
  'Raison du dernier échec de projection (NULL = aucun échec). La projection ne doit jamais échouer en silence.';
