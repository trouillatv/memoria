'use server'

// Réponse de l'équipe à un feedback (Vincent 2026-06-23).
// Admin uniquement. Passe par le client admin (service-role) pour fixer
// admin_reply_by = l'admin courant, puis marque le retour comme traité.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export async function replyToFeedbackAction(input: {
  feedbackId: string
  reply: string
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUserWithProfile()
  if (!me || me.role !== 'admin') return { ok: false, error: 'Accès refusé' }

  const reply = input.reply.trim()
  if (reply.length === 0) return { ok: false, error: 'La réponse est vide' }
  if (reply.length > 4000) return { ok: false, error: '4000 caractères max' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('feedback')
    .update({
      admin_reply: reply,
      admin_reply_at: new Date().toISOString(),
      admin_reply_by: me.id,
      reply_seen_at: null, // (re)notifie l'auteur d'une réponse fraîche
      status: 'done',
    })
    .eq('id', input.feedbackId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/feedback')
  return { ok: true }
}
