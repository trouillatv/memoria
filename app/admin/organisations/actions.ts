'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById, updateUserProfileAsAdmin } from '@/lib/db/users'
import { createOrganisation, assignUserToOrg, updateOrganisationBranding, setOrganisationLogo } from '@/lib/db/organisations'
import { uploadOrgLogo, deleteLogoFile } from '@/lib/storage/entity-logos'
import { logAuditEvent } from '@/lib/audit/log'
import type { UserRole } from '@/types/db'

const TEMP_PASSWORD = 'memoria2026'

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const createOrgSchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export async function createOrgAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = createOrgSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) return { error: 'Nom invalide' }

  const org = await createOrganisation(parsed.data.name)

  await logAuditEvent({
    userId: adminId, entityType: 'organization', entityId: org.id,
    action: 'created',
    metadata: { name: org.name, slug: org.slug },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const, org }
}

const createUserInOrgSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  // P1 isolation : jamais de rôle 'admin' (= super-admin plateforme) créé
  // DANS une organisation — un tenant n'a que manager / chef_equipe.
  role: z.enum(['manager', 'chef_equipe']),
  org_id: z.string().uuid(),
  mode: z.enum(['invite', 'temp_password']),
})

export async function createUserInOrgAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = createUserInOrgSchema.safeParse({
    email:     formData.get('email'),
    full_name: formData.get('full_name'),
    role:      formData.get('role'),
    org_id:    formData.get('org_id'),
    mode:      formData.get('mode'),
  })
  if (!parsed.success) return { error: 'Champs invalides' }

  const supabase = createAdminClient()
  const { email, full_name, role, org_id, mode } = parsed.data

  let userId: string
  if (mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Invitation échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: role as UserRole, full_name })
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      app_metadata: { role, must_change_password: true, organization_id: org_id },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Création échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: role as UserRole, full_name, must_change_password: true })
  }

  await assignUserToOrg(userId, org_id)

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: userId,
    action: 'created',
    metadata: { mode, email, role, org_id },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const }
}

const createOrgWithUserSchema = z.object({
  org_name:  z.string().min(1).max(100).trim(),
  email:     z.string().email(),
  full_name: z.string().min(1),
  role:      z.enum(['manager', 'chef_equipe']),
  mode:      z.enum(['invite', 'temp_password']),
})

export async function createOrgWithUserAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = createOrgWithUserSchema.safeParse({
    org_name:  formData.get('org_name'),
    email:     formData.get('email'),
    full_name: formData.get('full_name'),
    role:      formData.get('role'),
    mode:      formData.get('mode'),
  })
  if (!parsed.success) return { error: 'Champs invalides' }

  const { org_name, email, full_name, role, mode } = parsed.data

  const org = await createOrganisation(org_name)

  const supabase = createAdminClient()
  let userId: string
  if (mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Invitation échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: role as UserRole, full_name })
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      app_metadata: { role, must_change_password: true, organization_id: org.id },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Création échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: role as UserRole, full_name, must_change_password: true })
  }

  await assignUserToOrg(userId, org.id)

  await logAuditEvent({
    userId: adminId, entityType: 'organization', entityId: org.id,
    action: 'created',
    metadata: { name: org.name, slug: org.slug },
  })
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: userId,
    action: 'created',
    metadata: { mode, email, role, org_id: org.id },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const }
}

const updateOrgColorSchema = z.object({
  org_id: z.string().uuid(),
  color:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),
})

export async function updateOrgBrandingAction(formData: FormData) {
  await requireAdmin()
  const parsed = updateOrgColorSchema.safeParse({
    org_id: formData.get('org_id'),
    color:  formData.get('color') ?? '',
  })
  if (!parsed.success) return { error: 'Couleur invalide (format #RRGGBB attendu)' }

  await updateOrganisationBranding(parsed.data.org_id, {
    color: parsed.data.color || null,
  })

  revalidatePath('/admin/personnes')
  return { ok: true as const }
}

export async function uploadOrgLogoAction(formData: FormData) {
  await requireAdmin()
  const orgId = formData.get('org_id')
  if (typeof orgId !== 'string' || !orgId) return { error: 'org_id manquant' }
  const file = formData.get('logo') as File | null
  if (!file || file.size === 0) return { error: 'Fichier manquant' }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const path = await uploadOrgLogo(orgId, buffer, file.type)
    await setOrganisationLogo(orgId, path)
    revalidatePath('/admin/personnes')
    return { ok: true as const }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function removeOrgLogoAction(formData: FormData) {
  await requireAdmin()
  const orgId = formData.get('org_id')
  const logoPath = formData.get('logo_path')
  if (typeof orgId !== 'string' || !orgId) return { error: 'org_id manquant' }

  if (typeof logoPath === 'string' && logoPath) {
    await deleteLogoFile(logoPath).catch(() => { /* silencieux si déjà absent */ })
  }
  await setOrganisationLogo(orgId, null)
  revalidatePath('/admin/personnes')
  return { ok: true as const }
}

const assignOrgSchema = z.object({
  user_id: z.string().uuid(),
  org_id: z.string().uuid(),
})

export async function assignUserToOrgAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = assignOrgSchema.safeParse({
    user_id: formData.get('user_id'),
    org_id:  formData.get('org_id'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  await assignUserToOrg(parsed.data.user_id, parsed.data.org_id)

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
    action: 'updated',
    metadata: { field: 'organization_id', new_org: parsed.data.org_id },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const }
}
