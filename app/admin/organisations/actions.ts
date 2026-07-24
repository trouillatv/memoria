'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById, updateUserProfileAsAdmin } from '@/lib/db/users'
import { createOrganisation, assignUserToOrg, updateOrganizationMembershipRole, suspendOrganizationMembership, removeOrganizationMembership, updateOrganisationBranding, setOrganisationLogo } from '@/lib/db/organisations'
import { uploadOrgLogo, deleteLogoFile } from '@/lib/storage/entity-logos'
import { logAuditEvent } from '@/lib/audit/log'
import type { UserRole } from '@/types/db'

const TEMP_PASSWORD = 'memoria2026'
const organizationRoleSchema = z.enum(['admin', 'manager', 'chef_equipe'])
type OrganizationRole = z.infer<typeof organizationRoleSchema>

// `users.role` reste le rôle plateforme historique. Le repli `admin →
// chef_equipe` n'est donc PAS une conversion métier : il conserve uniquement
// une valeur historique compatible avec le profil/JWT jusqu'à la migration
// complète des rôles plateforme. Le vrai rôle admin reste sur le membership.
function profileRoleForOrganizationRole(role: OrganizationRole): Exclude<OrganizationRole, 'admin'> {
  return role === 'admin' ? 'chef_equipe' : role
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'admin') throw new Error('Forbidden')
  return user.id
}

function membershipMutationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('organization_membership_last_admin')) {
    return "Opération refusée : l'organisation doit conserver au moins un administrateur actif"
  }
  return message
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
  // `admin` est ici un rôle organisationnel. Il ne doit pas être recopié dans
  // `users.role`, qui reste le rôle plateforme historique.
  role: organizationRoleSchema,
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
  const profileRole = profileRoleForOrganizationRole(role)
  if (mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role: profileRole },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Invitation échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: profileRole as UserRole, full_name })
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      app_metadata: { role: profileRole, must_change_password: true, organization_id: org_id },
      user_metadata: { full_name, role: profileRole },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Création échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: profileRole as UserRole, full_name, must_change_password: true })
  }

  await assignUserToOrg(userId, org_id, role as UserRole)

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: userId,
    action: 'created',
    metadata: {
      mode,
      email,
      organization_id: org_id,
      organization_role: role,
      role_scope: 'organization',
      platform_profile_role: profileRole,
    },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const }
}

const createOrgWithUserSchema = z.object({
  org_name:  z.string().min(1).max(100).trim(),
  email:     z.string().email(),
  full_name: z.string().min(1),
  role:      organizationRoleSchema,
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
  const profileRole = profileRoleForOrganizationRole(role)
  let userId: string
  if (mode === 'invite') {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role: profileRole },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Invitation échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: profileRole as UserRole, full_name })
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      app_metadata: { role: profileRole, must_change_password: true, organization_id: org.id },
      user_metadata: { full_name, role: profileRole },
    })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Création échouée' }
    userId = data.user.id
    await updateUserProfileAsAdmin(userId, { role: profileRole as UserRole, full_name, must_change_password: true })
  }

  await assignUserToOrg(userId, org.id, role as UserRole)

  await logAuditEvent({
    userId: adminId, entityType: 'organization', entityId: org.id,
    action: 'created',
    metadata: { name: org.name, slug: org.slug },
  })
  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: userId,
    action: 'created',
    metadata: {
      mode,
      email,
      organization_id: org.id,
      organization_role: role,
      role_scope: 'organization',
      platform_profile_role: profileRole,
    },
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

const assignOrganizationRoleSchema = assignOrgSchema.extend({
  role: organizationRoleSchema,
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
    metadata: {
      field: 'organization_id',
      organization_id: parsed.data.org_id,
      role_scope: 'organization',
      operation: 'membership_added',
    },
  })

  revalidatePath('/admin/organisations')
  return { ok: true as const }
}

/** Affecte explicitement un rôle dans une organisation précise. */
export async function assignOrganizationRoleAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = assignOrganizationRoleSchema.safeParse({
    user_id: formData.get('user_id'),
    org_id:  formData.get('org_id'),
    role:    formData.get('role'),
  })
  if (!parsed.success) return { error: 'Utilisateur, organisation ou rôle invalide' }

  try {
    await updateOrganizationMembershipRole(parsed.data.user_id, parsed.data.org_id, parsed.data.role as UserRole)
  } catch (error) {
    const reason = membershipMutationError(error)
    await logAuditEvent({
      userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
      action: 'role_changed',
      metadata: {
        organization_id: parsed.data.org_id,
        organization_role: parsed.data.role,
        role_scope: 'organization',
        operation: 'role_change',
        result: 'rejected',
        reason,
      },
    })
    return { error: reason }
  }

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
    action: 'role_changed',
    metadata: {
      organization_id: parsed.data.org_id,
      organization_role: parsed.data.role,
      role_scope: 'organization',
      operation: 'role_change',
      result: 'accepted',
      platform_role_unchanged: true,
    },
  })

  revalidatePath('/admin/personnes')
  return { ok: true as const }
}

const membershipMutationSchema = assignOrgSchema

export async function suspendOrganizationMembershipAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = membershipMutationSchema.safeParse({
    user_id: formData.get('user_id'),
    org_id: formData.get('org_id'),
  })
  if (!parsed.success) return { error: 'Utilisateur ou organisation invalide' }

  try {
    await suspendOrganizationMembership(parsed.data.user_id, parsed.data.org_id)
  } catch (error) {
    const reason = membershipMutationError(error)
    await logAuditEvent({
      userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
      action: 'updated',
      metadata: {
        organization_id: parsed.data.org_id,
        role_scope: 'organization',
        operation: 'membership_suspend',
        result: 'rejected',
        reason,
      },
    })
    return { error: reason }
  }

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
    action: 'updated',
    metadata: {
      organization_id: parsed.data.org_id,
      role_scope: 'organization',
      operation: 'membership_suspend',
      result: 'accepted',
    },
  })
  revalidatePath('/admin/personnes')
  return { ok: true as const }
}

export async function removeOrganizationMembershipAction(formData: FormData) {
  const adminId = await requireAdmin()
  const parsed = membershipMutationSchema.safeParse({
    user_id: formData.get('user_id'),
    org_id: formData.get('org_id'),
  })
  if (!parsed.success) return { error: 'Utilisateur ou organisation invalide' }

  try {
    await removeOrganizationMembership(parsed.data.user_id, parsed.data.org_id)
  } catch (error) {
    const reason = membershipMutationError(error)
    await logAuditEvent({
      userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
      action: 'removed',
      metadata: {
        organization_id: parsed.data.org_id,
        role_scope: 'organization',
        operation: 'membership_remove',
        result: 'rejected',
        reason,
      },
    })
    return { error: reason }
  }

  await logAuditEvent({
    userId: adminId, entityType: 'user', entityId: parsed.data.user_id,
    action: 'removed',
    metadata: {
      organization_id: parsed.data.org_id,
      role_scope: 'organization',
      operation: 'membership_remove',
      result: 'accepted',
    },
  })
  revalidatePath('/admin/personnes')
  return { ok: true as const }
}
