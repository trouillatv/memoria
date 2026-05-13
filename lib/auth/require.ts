// Helpers d'autorisation partagés — point central pour toutes les server actions.
//
// Avant cette refonte, chaque fichier d'actions définissait son propre
// requireAdmin / requireManagerOrAdmin / requireFieldAgent. Chacun appelait
// `getUserRoleById` qui passe par l'admin client (bypass RLS). En conséquence,
// le contrôle d'accès reposait uniquement sur ces fonctions locales sans
// garde-fou Supabase.
//
// Cette version centralisée :
//   - utilise le server client (RLS-aware) pour la lecture du rôle ;
//   - retourne un type unifié `AuthResult` ;
//   - permet d'ajouter des règles transversales en un seul endroit (must_change_password,
//     compte soft-deleted, etc.).

import { createClient as createServerClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/db'

export type AuthOk = { ok: true; userId: string; role: UserRole }
export type AuthFail = { ok: false; error: string }
export type AuthResult = AuthOk | AuthFail

async function readCurrentRole(): Promise<AuthResult> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // RLS « users self read » autorise la lecture de sa propre ligne.
  const { data, error } = await supabase
    .from('users')
    .select('role, deleted_at')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) return { ok: false, error: 'Not authenticated' }
  if (data.deleted_at) return { ok: false, error: 'Account deleted' }

  return { ok: true, userId: user.id, role: data.role as UserRole }
}

export async function requireAdmin(): Promise<AuthResult> {
  const r = await readCurrentRole()
  if (!r.ok) return r
  if (r.role !== 'admin') return { ok: false, error: 'Forbidden' }
  return r
}

export async function requireManagerOrAdmin(): Promise<AuthResult> {
  const r = await readCurrentRole()
  if (!r.ok) return r
  if (r.role !== 'admin' && r.role !== 'manager') return { ok: false, error: 'Forbidden' }
  return r
}

export async function requireFieldAgent(): Promise<AuthResult> {
  const r = await readCurrentRole()
  if (!r.ok) return r
  if (r.role !== 'chef_equipe' && r.role !== 'manager' && r.role !== 'admin') {
    return { ok: false, error: 'Forbidden' }
  }
  return r
}

export async function requireAuthenticated(): Promise<AuthResult> {
  return readCurrentRole()
}
