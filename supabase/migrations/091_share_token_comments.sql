-- Migration 091 — Commentaires externes sur les dossiers de preuves partagés
--
-- Quand un client reçoit un lien /p/[token], il peut laisser un commentaire
-- global sur l'intervention. Pas d'auth requise (public). Le staff (admin/manager)
-- lit les commentaires dans la vue du dossier.
--
-- Doctrine :
--   - Un seul commentaire global par token (pas par photo).
--   - visitor_label : nom ou email optionnel laissé par le visiteur.
--   - Pas de modification/suppression côté visiteur (immuable après envoi).
--   - Soft rate-limit applicatif (3 commentaires / token / heure).

CREATE TABLE IF NOT EXISTS public.share_token_comments (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  token_id      uuid        NOT NULL REFERENCES public.proof_share_tokens(id) ON DELETE CASCADE,
  visitor_label text        CHECK (char_length(visitor_label) <= 100),
  comment       text        NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
  ip_hash       text,
  created_at    timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.share_token_comments IS
  'Commentaires laissés par des visiteurs externes sur un dossier de preuves partagé via /p/[token].';

CREATE INDEX idx_stc_token_id ON public.share_token_comments(token_id);
CREATE INDEX idx_stc_created_at ON public.share_token_comments(created_at);

ALTER TABLE public.share_token_comments ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut insérer (page publique sans auth)
CREATE POLICY "stc_insert_public"
  ON public.share_token_comments FOR INSERT
  WITH CHECK (true);

-- Seuls admin/manager peuvent lire
CREATE POLICY "stc_select_staff"
  ON public.share_token_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
        AND deleted_at IS NULL
    )
  );
