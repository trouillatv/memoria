'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { updateUserRoleAsAdmin, softDeleteUserAsAdmin } from '@/lib/db/users'
import type { UserRole } from '@/types/db'

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') throw new Error('Forbidden')
  return user.id
}

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
      await supabase.from('users').update({ role: parsed.data.role, full_name: parsed.data.full_name }).eq('id', data.user.id)
      await logAuditEvent({
        userId: adminId, entityType: 'user', entityId: data.user.id,
        action: 'created',
        metadata: { mode: 'invite', email: parsed.data.email, role: parsed.data.role },
      })
    }
  } else {
    const tempPassword = process.env.INITIAL_ADMIN_PASSWORD || 'netoiage2026'
    const { data, error } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: parsed.data.role },
      user_metadata: { full_name: parsed.data.full_name, role: parsed.data.role },
    })
    if (error) return { error: error.message }
    if (data.user) {
      await supabase.from('users').update({
        role: parsed.data.role,
        full_name: parsed.data.full_name,
        must_change_password: true,
      }).eq('id', data.user.id)
      await logAuditEvent({
        userId: adminId, entityType: 'user', entityId: data.user.id,
        action: 'created',
        metadata: { mode: 'temp_password', email: parsed.data.email, role: parsed.data.role },
      })
    }
  }

  revalidatePath('/admin/users')
  return { ok: true }
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

  const supabase = createAdminClient()
  const { data: before } = await supabase.from('users').select('role').eq('id', parsed.data.userId).single()
  await updateUserRoleAsAdmin(parsed.data.userId, parsed.data.role as UserRole)
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'role_changed',
    metadata: { from: before?.role, to: parsed.data.role },
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

const forceResetSchema = z.object({ userId: z.string().uuid() })

export async function forcePasswordResetAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = forceResetSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Invalid' }

  const supabase = createAdminClient()
  const { data: target } = await supabase.from('users').select('role').eq('id', parsed.data.userId).single()
  if (target?.role === 'admin') return { error: 'Reset admin via Supabase Studio uniquement' }

  const tempPassword = process.env.INITIAL_ADMIN_PASSWORD || 'netoiage2026'
  await supabase.auth.admin.updateUserById(parsed.data.userId, { password: tempPassword })
  await supabase.from('users').update({ must_change_password: true }).eq('id', parsed.data.userId)
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.userId,
    action: 'password_reset_forced',
    metadata: { temp_password_set: true },
  })
  revalidatePath('/admin/users')
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
