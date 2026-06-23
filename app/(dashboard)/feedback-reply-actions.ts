'use server'

// Réponses de l'équipe vues par l'AUTEUR du feedback (Vincent 2026-06-23).
// Lecture via client admin filtrée sur user_id = moi (la RLS feedback est
// admin-only en SELECT ; on garde ce canal et on borne explicitement au compte
// courant). « Vu » = reply_seen_at non nul.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

export interface MyFeedbackReply {
  id: string
  message: string
  admin_reply: string
  admin_reply_at: string | null
  reply_seen_at: string | null
  created_at: string
}

async function currentUserId(): Promise<string | null> {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  return user?.id ?? null
}

export async function getMyFeedbackReplies(): Promise<MyFeedbackReply[]> {
  const uid = await currentUserId()
  if (!uid) return []
  const admin = createAdminClient()
  const { data } = await admin
    .from('feedback')
    .select('id, message, admin_reply, admin_reply_at, reply_seen_at, created_at')
    .eq('user_id', uid)
    .not('admin_reply', 'is', null)
    .order('admin_reply_at', { ascending: false })
    .limit(20)
  return (data ?? []) as MyFeedbackReply[]
}

export async function markMyFeedbackRepliesSeen(): Promise<void> {
  const uid = await currentUserId()
  if (!uid) return
  const admin = createAdminClient()
  await admin
    .from('feedback')
    .update({ reply_seen_at: new Date().toISOString() })
    .eq('user_id', uid)
    .not('admin_reply', 'is', null)
    .is('reply_seen_at', null)
}
