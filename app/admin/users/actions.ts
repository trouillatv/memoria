'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { updateUserRoleAsAdmin, softDeleteUserAsAdmin, getUserRoleById, updateUserProfileAsAdmin } from '@/lib/db/users'
import type { UserRole } from '@/types/db'

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'admin') throw new Error('Forbidden')
  return user.id
}

// Mdp temporaire partagé — décision DG 2026-05-14.
// Le même mot de passe pour tous les comptes créés en mode temp_password et
// pour tous les resets. Le flag must_change_password + middleware enforce
// le changement à la première connexion. Voir docs/10_JOURNAL_DECISIONS.md.
const TEMP_PASSWORD = 'memoria2026'

const createSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'chef_equipe']),
  mode: z.enum(['invite', 'temp_password']),
})

export async function createUserAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = createSchema.safeParse({
    email:     formData.get('email'),
    full_name: formData.get('full_name'),
    role:      formData.get('role'),
    mode:      formData.get('mode'),
  })
  if (!parsed.success) return { error: 'Champs invalides' }

  const supabase = createAdminClient()

  if (parsed.data.mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: { full_name: parsed.data.full_name, role: parsed.data.role },
    })
    if (error) return { error: error.message }
    if (data.user) {
      await updateUserProfileAsAdmin(data.user.id, { role: parsed.data.role, full_name: parsed.data.full_name })
      await logAuditEvent({
        userId: adminId, entityType: 'user', entityId: data.user.id,
        action: 'created',
        metadata: { mode: 'invite', email: parsed.data.email, role: parsed.data.role },
      })
    }
    return { ok: true as const }
  }

  // Mode temp_password : mdp partagé connu de l'admin.
  const { data, error } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: TEMP_PASSWORD,
    email_confirm: true,
    app_metadata: { role: parsed.data.role, must_change_password: true },
    user_metadata: { full_name: parsed.data.full_name, role: parsed.data.role },
  })
  if (error) return { error: error.message }
  if (!data.user) return { error: 'Création échouée' }

  await updateUserProfileAsAdmin(data.user.id, {
    role: parsed.data.role,
    full_name: parsed.data.full_name,
    must_change_password: true,
  })
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: data.user.id,
    action: 'created',
    metadata: { mode: 'temp_password', email: parsed.data.email, role: parsed.data.role },
  })

  revalidatePath('/admin/users')
  return { ok: true as const }
}

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'manager', 'chef_equipe']),
})

export async function changeUserRoleAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = roleSchema.safeParse({
    userId: formData.get('userId'),
    role:   formData.get('role'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  const beforeRole = await getUserRoleById(parsed.data.userId)
  await updateUserRoleAsAdmin(parsed.data.userId, parsed.data.role as UserRole)

  // Synchronise le rôle dans app_metadata du JWT pour que les RLS le voient
  // sans attendre 1h de refresh JWT.
  const supabase = createAdminClient()
  const { data: existing } = await supabase.auth.admin.getUserById(parsed.data.userId)
  if (existing.user) {
    await supabase.auth.admin.updateUserById(parsed.data.userId, {
      app_metadata: { ...(existing.user.app_metadata ?? {}), role: parsed.data.role },
    })
  }

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'role_changed',
    metadata: { from: beforeRole, to: parsed.data.role },
  })
  revalidatePath('/admin/users')
  return { ok: true as const }
}

const forceResetSchema = z.object({ userId: z.string().uuid() })

export async function forcePasswordResetAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = forceResetSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Invalid' }

  const supabase = createAdminClient()
  const targetRole = await getUserRoleById(parsed.data.userId)
  if (targetRole === 'admin') return { error: 'Reset admin via Supabase Studio uniquement' }

  const { data: existing } = await supabase.auth.admin.getUserById(parsed.data.userId)
  const appMetadata = { ...(existing.user?.app_metadata ?? {}), must_change_password: true }

  const { error } = await supabase.auth.admin.updateUserById(parsed.data.userId, {
    password: TEMP_PASSWORD,
    app_metadata: appMetadata,
  })
  if (error) return { error: error.message }

  await updateUserProfileAsAdmin(parsed.data.userId, { must_change_password: true })
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'password_reset_forced',
    metadata: { temp_password_set: true },
  })
  revalidatePath('/admin/users')
  return { ok: true as const }
}

// Sprint 4 PC — admin/manager peut éditer le téléphone d'un user.
// Format E.164 validé côté DB (CHECK) ET côté server (zod).
// Doctrine V5 : coordonnée de contact, jamais signal comportemental.
async function requireAdminOrManager() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') throw new Error('Forbidden')
  return user.id
}

const phoneSchema = z.object({
  userId: z.string().uuid(),
  phone: z
    .string()
    .trim()
    // Tolère espaces/tirets en entrée — normalisation côté action.
    .transform((s) => s.replace(/[\s.\-_]/g, ''))
    .refine((s) => s === '' || /^\+[0-9]{7,15}$/.test(s), {
      message: 'Format E.164 attendu (ex : +687123456)',
    }),
})

export async function updateUserPhoneAction(formData: FormData) {
  const actorId = await requireAdminOrManager()
  const parsed = phoneSchema.safeParse({
    userId: formData.get('userId'),
    phone: formData.get('phone'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Format invalide' }
  }

  const supabase = createAdminClient()
  const value = parsed.data.phone === '' ? null : parsed.data.phone
  const { error } = await supabase
    .from('users')
    .update({ phone: value })
    .eq('id', parsed.data.userId)
  if (error) return { error: 'Impossible de mettre à jour le numéro.' }

  await logAuditEvent({
    userId: actorId,
    entityType: 'user',
    entityId: parsed.data.userId,
    action: 'updated',
    metadata: { field: 'phone', cleared: value === null },
  })
  revalidatePath('/admin/users')
  revalidatePath('/briefing')
  return { ok: true }
}

const deleteSchema = z.object({ userId: z.string().uuid() })

export async function deleteUserAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = deleteSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Invalid' }
  if (parsed.data.userId === adminId) return { error: 'Vous ne pouvez pas vous supprimer vous-même' }

  await softDeleteUserAsAdmin(parsed.data.userId)
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'soft_deleted',
  })
  revalidatePath('/admin/users')
  return { ok: true }
}
