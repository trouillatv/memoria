-- Migration 093 — Photos uploadées par le visiteur externe dans son commentaire
--
-- Un visiteur sur /p/[token] peut joindre jusqu'à 3 photos à son commentaire.
-- Les chemins Supabase Storage sont stockés ici (bucket intervention-photos,
-- préfixe share-comments/).
-- NULL si aucune photo — pas de contrainte NOT NULL (commentaire texte seul valide).

ALTER TABLE public.share_token_comments
  ADD COLUMN IF NOT EXISTS photo_paths text[];

COMMENT ON COLUMN public.share_token_comments.photo_paths IS
  'Chemins Storage (bucket intervention-photos) des photos jointes par le visiteur externe. NULL si aucune photo. Max 3 (cap applicatif).';
