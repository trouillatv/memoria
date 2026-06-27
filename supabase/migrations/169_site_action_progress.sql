-- 169 — Action « Fait aujourd'hui » : l'état INTERMÉDIAIRE (Vincent 2026-06-28)
--
-- Le modèle d'action était binaire (open → done). La réalité terrain a TROIS temps :
--   open → « fait aujourd'hui » (avancée du jour) → traitée définitivement (plus tard)
-- « Fait aujourd'hui » n'est PAS une clôture : le status reste 'open', l'action reste
-- vivante. Elle sort juste du « à faire » du jour et réapparaît demain si rien ne la
-- clôt. Ça sépare le TRAVAIL terrain (« je marque ce que j'ai fait pendant ma tournée »)
-- du PILOTAGE (au bureau, on décide tranquillement ce qui se clôt définitivement).
-- Cf. doctrine Action ≠ intervention ([[actions-troisieme-pilier]]).
--
-- last_progress_at = horodatage de la dernière avancée. Filtrage : = aujourd'hui →
-- section « Fait aujourd'hui » ; sinon l'action reste dans « à faire ».

alter table public.site_actions
  add column if not exists last_progress_at timestamptz;

comment on column public.site_actions.last_progress_at is
  'Dernière avancée terrain « Fait aujourd''hui » (mig 169). N''est PAS une clôture : status reste open. Si = aujourd''hui l''action passe en section « Fait aujourd''hui » ; sinon elle revient dans « à faire ». Sépare travail terrain (marquer ce qui est fait) et pilotage (clôturer définitivement).';
