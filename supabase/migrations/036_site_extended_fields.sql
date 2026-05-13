-- Champs structurés "fiche site" pour la mémoire des lieux opérationnelle.
-- Doctrine V5 : info descriptive, format passif. Ces champs servent au chef
-- d'équipe quand il prépare/exécute une intervention — code d'entrée, contact,
-- horaires. Le champ `notes` existant reste pour le texte libre, et les
-- `site_notes` datées restent pour les notes vivantes (mémoire des lieux V5).

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS access_code text,
  ADD COLUMN IF NOT EXISTS alarm_code text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS access_hours text,
  ADD COLUMN IF NOT EXISTS access_instructions text;

COMMENT ON COLUMN public.sites.access_code IS
  'Code d''entrée / digicode / portail. Information descriptive opérationnelle.';
COMMENT ON COLUMN public.sites.alarm_code IS
  'Code alarme. Information descriptive opérationnelle.';
COMMENT ON COLUMN public.sites.contact_name IS
  'Nom du contact sur site (gardien, responsable, etc.).';
COMMENT ON COLUMN public.sites.contact_phone IS
  'Téléphone du contact sur site. Format libre (pas de contrainte E.164).';
COMMENT ON COLUMN public.sites.access_hours IS
  'Horaires d''accès au site (ex. "Lun-Ven 7h-19h, Sam 8h-12h").';
COMMENT ON COLUMN public.sites.access_instructions IS
  'Instructions d''accès libres (étage, ascenseur, parking, boîte à clés…).';
