// V5.1 — Helper d'authentification partagé entre les server actions field.
//
// Extrait de app/(field)/m/intervention/[id]/actions.ts (Slice 1, 2026-05-14)
// pour être réutilisé par les nouvelles actions du dépôt spontané sur site.
//
// chef_equipe = production agent (Joseph côté terrain).
// admin/manager = QA sur /m (Guillaume et Maeva peuvent tester le flow mobile).
// Tout autre rôle = refus.

import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import type { UserRole } from '@/types/db'

// Lot S : le rôle est désormais rendu à l'appelant — une action terrain qui
// mute un objet par id doit pouvoir appeler requireOwned(auth.role, …).
export async function requireFieldAgent(): Promise<
  { userId: string; role: UserRole } | { error: string }
> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'chef_equipe' && role !== 'admin' && role !== 'manager') {
    return { error: 'Forbidden' }
  }
  return { userId: user.id, role }
}
