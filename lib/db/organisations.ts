import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedLogoUrls } from '@/lib/storage/entity-logos'
import type { UserRole } from '@/types/db'

/** Le rôle du PROFIL, repli quand l'appelant n'en impose pas. Tant que M2/M3
 *  n'ont pas migré les contrôles de rôle, c'est lui qui fait foi ailleurs. */
async function lireRoleProfil(
  sb: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<UserRole> {
  const { data } = await sb.from('users').select('role').eq('id', userId).maybeSingle()
  return ((data as { role?: UserRole } | null)?.role ?? 'chef_equipe') as UserRole
}

export interface DbOrganisation {
  id: string
  name: string
  slug: string
  created_at: string
  user_count: number
  /** M4a — chemin bucket entity-logos (ex. organizations/{id}/logo.png). */
  logo_path?: string | null
  logo_updated_at?: string | null
  /** DEPRECATED — remplacé par logo_path. */
  logo_url?: string | null
  /** M4a — couleur hexadécimale (#RRGGBB) pour le badge/dot fallback. */
  color?: string | null
}

/** M4a — métadonnées de branding pour un badge enrichi (logo + couleur). */
export interface OrgMeta {
  id: string
  label: string
  logoUrl: string | null
  color: string | null
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * M3 — libellés d'organisation pour les badges du dashboard. UNE lecture pour
 * tous les ids → map `id → libellé court` (slug si présent, sinon nom). Zéro N+1.
 * Le dashboard n'appelle ceci QUE pour un compte multi-organisations.
 */
export async function getOrganizationLabels(orgIds: string[]): Promise<Record<string, string>> {
  if (orgIds.length === 0) return {}
  const { data } = await createAdminClient()
    .from('organizations').select('id, name, slug').in('id', orgIds)
  const out: Record<string, string> = {}
  for (const o of (data ?? []) as Array<{ id: string; name: string; slug: string | null }>) {
    out[o.id] = (o.slug || o.name || '').trim()
  }
  return out
}

/**
 * M4a — métadonnées de branding (label + logo + couleur). UNE lecture pour tous
 * les ids. Utilisé par le layout et les badges enrichis. En mono-org, ne pas
 * appeler (interface inchangée).
 */
export async function getOrganizationsMeta(orgIds: string[]): Promise<OrgMeta[]> {
  if (orgIds.length === 0) return []
  const { data } = await createAdminClient()
    .from('organizations').select('id, name, slug, logo_path, color').in('id', orgIds).order('name')
  const rows = (data ?? []) as Array<{
    id: string; name: string; slug: string | null
    logo_path: string | null; color: string | null
  }>
  const paths = rows.filter((o) => o.logo_path).map((o) => o.logo_path!)
  const signedUrls = await getSignedLogoUrls(paths)
  return rows.map((o) => ({
    id: o.id,
    label: (o.slug || o.name || '').trim(),
    logoUrl: o.logo_path ? (signedUrls[o.logo_path] ?? null) : null,
    color: o.color ?? null,
  }))
}

/** Met à jour la couleur hexadécimale de l'organisation. */
export async function updateOrganisationBranding(orgId: string, branding: {
  color?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('organizations')
    .update(branding)
    .eq('id', orgId)
  if (error) throw error
}

/** Enregistre le chemin bucket du logo après un upload réussi, ou null à la suppression. */
export async function setOrganisationLogo(orgId: string, path: string | null): Promise<void> {
  const { error } = await createAdminClient()
    .from('organizations')
    .update({ logo_path: path, logo_updated_at: path ? new Date().toISOString() : null })
    .eq('id', orgId)
  if (error) throw error
}

export async function listOrganisations(): Promise<DbOrganisation[]> {
  const sb = createAdminClient()
  const [{ data: orgs, error }, { data: users }] = await Promise.all([
    sb.from('organizations').select('id, name, slug, created_at, logo_path, logo_updated_at, color').order('created_at', { ascending: true }),
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

export async function assignUserToOrg(userId: string, orgId: string, role?: UserRole): Promise<void> {
  const sb = createAdminClient()

  // ── L'APPARTENANCE S'AJOUTE, ELLE NE REMPLACE PAS (M1, mig 233) ──────────
  //
  // Cette fonction faisait un simple UPDATE de `users.organization_id` : un
  // DÉPLACEMENT. Inviter Guillaume dans SERVINOR l'aurait donc retiré d'AGP,
  // en silence — exactement ce que le multi-organisations doit rendre
  // impossible.
  //
  // IDEMPOTENT par construction : l'index unique (user_id, organization_id)
  // rend une réinvitation inoffensive, même sur deux appels concurrents. Le
  // rôle n'est réécrit que s'il est fourni — réinviter quelqu'un ne doit pas
  // silencieusement lui retirer les droits qu'un administrateur lui a donnés.
  const roleAPoser = role ?? (await lireRoleProfil(sb, userId))
  const { error: mErr } = await sb
    .from('organization_memberships')
    .upsert(
      { user_id: userId, organization_id: orgId, role: roleAPoser, status: 'active', updated_at: new Date().toISOString() },
      { onConflict: 'user_id,organization_id' },
    )
  if (mErr) throw mErr

  // L'ancien modèle SURVIT le temps que M2/M3 migrent les 193 lecteurs de
  // `getOrgId()`. Pour un compte mono-organisation, colonne et appartenance
  // coïncident — c'est l'invariant qui empêche les deux de diverger.
  // Pour un compte MULTI, la colonne devient une organisation par défaut et
  // cesse de faire autorité : `getOrgId()` refuse alors de répondre.
  const { data: appartenances } = await sb
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('status', 'active')
  const multi = ((appartenances ?? []) as unknown[]).length > 1
  if (!multi) {
    const { error } = await sb.from('users').update({ organization_id: orgId }).eq('id', userId)
    if (error) throw error
  }
  // Sync auth app_metadata so JWT claims stay coherent
  const { data: existing } = await sb.auth.admin.getUserById(userId)
  if (existing.user) {
    await sb.auth.admin.updateUserById(userId, {
      // ⚠️ Le claim JWT reste MONO-organisation : c'est l'ancien modèle. Il
      // n'est pas une autorisation — les gardes relisent l'appartenance en
      // base. M2/M3 décideront de son sort.
      app_metadata: { ...(existing.user.app_metadata ?? {}), organization_id: orgId },
    })
  }
}
