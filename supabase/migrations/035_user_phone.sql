-- Numéro de téléphone pour WhatsApp deep link 1-à-1
-- Doctrine V5 : coordonnée de contact comme l'email, jamais signal comportemental
-- Maxim 9 : utilisé pour wa.me 1-à-1, jamais pour groupe collectif

ALTER TABLE public.users
  ADD COLUMN phone text,
  ADD CONSTRAINT chk_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+[0-9]{7,15}$');

COMMENT ON COLUMN public.users.phone IS
  'Numéro téléphone format E.164. Utilisé pour WhatsApp deep link briefing. Coordonnée de contact, pas signal comportemental (Maxim 9 anti-tracking respecté).';
