// Socle « Notifications utilisateur » (mig 159, Vincent 2026-06-23).
//
// createNotification = service-role (émis par une action serveur au nom d'un
// AUTRE utilisateur). Lecture/maj = client serveur (RLS owner).
//
// Doctrine : on n'émet une notification que pour un TYPE ayant passé la
// discipline d'apparition. Aujourd'hui : 'feedback_reply' uniquement.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'

export type NotificationType = 'feedback_reply'

export interface UserNotification {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/**
 * Crée (ou rafraîchit) une notification pour `userId`. Si `dedupeKey` est fourni
 * et qu'une notification de même clé existe déjà, on la REMPLACE (re-non-lue) —
 * évite d'empiler 3 notifs si l'admin édite sa réponse 3 fois.
 */
export async function createNotification(input: {
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  dedupeKey?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (input.dedupeKey) {
    await admin
      .from('notifications')
      .delete()
      .eq('user_id', input.userId)
      .eq('dedupe_key', input.dedupeKey)
  }
  await admin.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    dedupe_key: input.dedupeKey ?? null,
  })
}

/** Notifications non lues du compte courant (plus récentes d'abord). */
export async function getMyUnreadNotifications(limit = 10): Promise<UserNotification[]> {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return []
  const { data } = await sb
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as UserNotification[]
}

/** Marque une notification (du compte courant) comme lue. */
export async function markNotificationRead(id: string): Promise<void> {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return
  await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
}
