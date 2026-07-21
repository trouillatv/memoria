-- =============================================================================
-- 229 — UN TÉLÉPHONE OUVRE SUR LE TERRAIN.
--
-- `home_preference` valait 'dashboard' par défaut (mig 093). Conséquence :
-- `resolveHomeDestination` renvoyait un téléphone vers /dashboard — le pilotage,
-- pensé pour un grand écran — alors que celui qui se connecte depuis un
-- téléphone est, presque toujours, sur un chantier.
--
-- Le nouveau défaut est 'terrain'. Il ne force rien : `resolveHomeDestination`
-- envoie TOUJOURS un ordinateur sur /dashboard, quelle que soit la préférence.
-- La préférence ne décide donc que du cas « téléphone », et 'dashboard' y reste
-- un choix explicite parfaitement respecté.
--
-- Les lignes EXISTANTES ne sont pas touchées : un choix déjà exprimé reste un
-- choix. Seuls les comptes créés ensuite héritent du nouveau défaut.
-- =============================================================================

alter table public.users
  alter column home_preference set default 'terrain';

comment on column public.users.home_preference is
  'Vue d''accueil sur TÉLÉPHONE (terrain | dashboard). Un ordinateur ouvre toujours le bureau.';
