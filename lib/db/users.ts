import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbUser, UserRole } from '@/types/db'

/**
 * Récupère le user authentifié courant + son profil métier (role).
 * Renvoie null si pas authentifié.
 *
 * Utilisée partout dans les Server Components / Server Actions —
 * point de centralisation pour l'éventuelle migration multi-tenant
 * (filtre par company_id à ajouter ici plus tard).
 */
export async function getCurrentUserWithProfile(): Promise<DbUser | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null
  return data as DbUser
}

/**
 * Liste des utilisateurs (admin only).
 * Utilise le service role pour bypass RLS quand l'admin gère les users.
 */
export async function listUsersForAdmin(): Promise<DbUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as DbUser[]
}

export async function updateUserRoleAsAdmin(userId: string, role: UserRole): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
  if (error) throw error
}

export async function softDeleteUserAsAdmin(userId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}
