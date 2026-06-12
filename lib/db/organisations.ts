import { createAdminClient } from '@/lib/supabase/admin'

export interface DbOrganisation {
  id: string
  name: string
  slug: string
  created_at: string
  user_count: number
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function listOrganisations(): Promise<DbOrganisation[]> {
  const sb = createAdminClient()
  const [{ data: orgs, error }, { data: users }] = await Promise.all([
    sb.from('organizations').select('id, name, slug, created_at').order('created_at', { ascending: true }),
    sb.from('users').select('organization_id').is('deleted_at', null),
  ])
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const u of users ?? []) {
    if (u.organization_id) counts[u.organization_id] = (counts[u.organization_id] ?? 0) + 1
  }

  return (orgs ?? []).map((o) => ({ ...o, user_count: counts[o.id] ?? 0 }))
}

export async function createOrganisation(name: string): Promise<DbOrganisation> {
  const sb = createAdminClient()
  const slug = slugify(name)
  const { data, error } = await sb
    .from('organizations')
    .insert({ name: name.trim(), slug })
    .select('id, name, slug, created_at')
    .single()
  if (error) throw error
  return { ...data, user_count: 0 }
}

export async function assignUserToOrg(userId: string, orgId: string): Promise<void> {
  const sb = createAdminClient()
  const { error } = await sb.from('users').update({ organization_id: orgId }).eq('id', userId)
  if (error) throw error
  // Sync auth app_metadata so JWT claims stay coherent
  const { data: existing } = await sb.auth.admin.getUserById(userId)
  if (existing.user) {
    await sb.auth.admin.updateUserById(userId, {
      app_metadata: { ...(existing.user.app_metadata ?? {}), organization_id: orgId },
    })
  }
}
