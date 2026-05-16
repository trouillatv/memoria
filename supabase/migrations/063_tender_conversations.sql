-- Migration 063 : onglets de conversations nommés dans l'atelier IA
-- Ajoute tender_conversations (onglets) + conversation_id sur tender_chat_messages.

CREATE TABLE IF NOT EXISTS public.tender_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id   uuid        NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT 'Conversation',
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tender_conversations_tender_id
  ON public.tender_conversations (tender_id);

ALTER TABLE public.tender_chat_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid
    REFERENCES public.tender_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tender_chat_messages_conversation_id
  ON public.tender_chat_messages (conversation_id);

-- RLS : lecture par utilisateur connecté
ALTER TABLE public.tender_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_conversations_select" ON public.tender_conversations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "tender_conversations_insert" ON public.tender_conversations
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tender_conversations_update" ON public.tender_conversations
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "tender_conversations_delete" ON public.tender_conversations
  FOR DELETE USING (auth.role() = 'authenticated');
