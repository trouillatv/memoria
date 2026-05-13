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
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at, phone')
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
    .select('id, email, full_name, role, must_change_password, created_at, deleted_at, phone')
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

/**
 * Récupère le rôle d'un utilisateur (par son id).
 *
 * Stratégie défense en profondeur (audit sécurité 2026-05-13) :
 *   - Self-read (userId = user authentifié courant) : passe par le server client,
 *     RLS applicable, pas de bypass.
 *   - Cross-user (admin lit un autre user) : fallback admin client (bypass RLS).
 *
 * Renvoie null si pas trouvé. Utilisé pour les checks d'autorisation côté
 * Server Action (ex. requireAdmin).
 */
export async function getUserRoleById(userId: string): Promise<UserRole | null> {
  // 1. Tentative server client (RLS-aware) : autorise la lecture de soi.
  try {
    const serverSb = await createServerClient()
    const { data: { user } } = await serverSb.auth.getUser()
    if (user?.id === userId) {
      const { data } = await serverSb
        .from('users')
        .select('role')
        .eq('id', userId)
        .is('deleted_at', null)
        .maybeSingle()
      if (data?.role) return data.role as UserRole
    }
  } catch {
    // Pas de session ou pas de cookies (ex: appel depuis script) — fallback admin.
  }

  // 2. Fallback admin (cross-user lookup ou pas de session).
  const adminSb = createAdminClient()
  const { data, error } = await adminSb
    .from('users')
    .select('role')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return data.role as UserRole
}

/**
 * Récupère le rôle du user authentifié courant via server client (RLS).
 * API préférée pour le code neuf — pas de bypass admin par défaut.
 * Renvoie null si pas de session ou compte supprimé.
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return data.role as UserRole
}

/**
 * Récupère un mini-profil (role + must_change_password) pour le user authentifié courant.
 * Pour login/redirect logic. Utilise le client serveur (cookies), passe par RLS.
 */
export async function getCurrentUserMiniProfile(): Promise<{ role: UserRole; must_change_password: boolean } | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('users')
    .select('role, must_change_password')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return { role: data.role as UserRole, must_change_password: data.must_change_password }
}

/**
 * Met à jour les champs de profil d'un utilisateur (par id, en tant qu'admin).
 * Service role — bypass RLS.
 */
export async function updateUserProfileAsAdmin(
  userId: string,
  fields: { full_name?: string; role?: UserRole; must_change_password?: boolean; phone?: string | null }
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('users').update(fields).eq('id', userId)
  if (error) throw error
}

/**
 * Marque must_change_password = false pour le user authentifié courant.
 * Pour les flows accept-invite et change-password.
 * Utilise le client serveur (cookies), passe par RLS auto-only.
 */
export async function clearMustChangePasswordForCurrentUser(): Promise<void> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await supabase
    .from('users')
    .update({ must_change_password: false })
    .eq('id', user.id)
  if (error) throw error
}
