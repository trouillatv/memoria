import 'server-only'

// Nœuds de mémoire (scopes) — Sprint 3, migration 117.
//
// Un scope = un sous-périmètre interrogeable d'un site (VRD, Réseau EP, Bât. B…).
// Concrétise la chaîne d'adressage : Organisation → Site → Scope → Contenu.
//
// SÉCURITÉ : le client admin contourne la RLS → CHAQUE requête filtre
// explicitement organization_id (convention du repo, cf. mig 114). Les mutations
// vérifient l'appartenance org + site avant d'écrire.
//
// S3 = un seul niveau sous le site (parent_scope_id = null). Le rattachement est
// prouvé avec les actions (site_actions.scope_id) ; d'autres contenus (anomalies,
// photos, événements) se brancheront à l'identique plus tard.

import { createAdminClient } from '@/lib/supabase/admin'
import type { SiteActionStatus } from '@/types/db'

export interface MemoryScope {
  id: string
  organizationId: string
  siteId: string
  parentScopeId: string | null
  scopeTypeKey: string | null
  label: string
  description: string | null
  createdAt: string
}

export interface ScopeWithCount extends MemoryScope {
  /** Nombre d'éléments de contenu rattachés (S3 : actions). */
  contentCount: number
}

export interface ScopeActionRow {
  id: string
  title: string
  body: string | null
  corpsEtat: string | null
  status: SiteActionStatus
  createdAt: string
  scopeId: string | null
}

function mapScope(r: Record<string, unknown>): MemoryScope {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    siteId: r.site_id as string,
    parentScopeId: (r.parent_scope_id as string | null) ?? null,
    scopeTypeKey: (r.scope_type_key as string | null) ?? null,
    label: r.label as string,
    description: (r.description as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

/** Scopes de premier niveau d'un site (sous le site), avec le compte de contenu. */
export async function listSiteScopes(siteId: string, orgId: string): Promise<ScopeWithCount[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('memory_scopes')
    .select('*')
    .eq('site_id', siteId)
    .eq('organization_id', orgId)
    .is('parent_scope_id', null)
    .is('deleted_at', null)
    .eq('active', true)
    .order('label', { ascending: true })
  if (error) throw error
  const scopes = ((data ?? []) as Record<string, unknown>[]).map(mapScope)
  if (scopes.length === 0) return []

  // Comptes de contenu (actions rattachées), en une requête sur le site.
  const { data: acts } = await supabase
    .from('site_actions')
    .select('scope_id')
    .eq('site_id', siteId)
    .not('scope_id', 'is', null)
  const counts = new Map<string, number>()
  for (const a of (acts ?? []) as { scope_id: string }[]) {
    counts.set(a.scope_id, (counts.get(a.scope_id) ?? 0) + 1)
  }
  return scopes.map((s) => ({ ...s, contentCount: counts.get(s.id) ?? 0 }))
}

/** Un scope précis, vérifié dans l'org. */
export async function getScope(scopeId: string, orgId: string): Promise<MemoryScope | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('memory_scopes')
    .select('*')
    .eq('id', scopeId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data ? mapScope(data as Record<string, unknown>) : null
}

/** Crée un scope sous un site. Vérifie que le site appartient à l'org. */
export async function createScope(input: {
  orgId: string
  siteId: string
  label: string
  scopeTypeKey?: string | null
  description?: string | null
  parentScopeId?: string | null
  createdBy: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  // Garde-fou : le site doit appartenir à l'org.
  const { data: site } = await supabase
    .from('sites')
    .select('id, organization_id')
    .eq('id', input.siteId)
    .maybeSingle()
  if (!site || (site as { organization_id: string }).organization_id !== input.orgId) {
    throw new Error('Site introuvable dans cette organisation')
  }
  const { data, error } = await supabase
    .from('memory_scopes')
    .insert({
      organization_id: input.orgId,
      site_id: input.siteId,
      parent_scope_id: input.parentScopeId ?? null,
      scope_type_key: input.scopeTypeKey ?? null,
      label: input.label,
      description: input.description ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Soft-delete d'un scope (le contenu est dé-rattaché par on delete set null). */
export async function softDeleteScope(scopeId: string, orgId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('memory_scopes')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', scopeId)
    .eq('organization_id', orgId)
  if (error) throw error
}

/** Contenu rattaché à un scope (S3 : les actions). « Que sait-on sur X ? » */
export async function listScopeActions(scopeId: string): Promise<ScopeActionRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('id, title, body, corps_etat, status, created_at, scope_id')
    .eq('scope_id', scopeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    corpsEtat: (r.corps_etat as string | null) ?? null,
    status: r.status as SiteActionStatus,
    createdAt: r.created_at as string,
    scopeId: (r.scope_id as string | null) ?? null,
  }))
}

/** Actions du site (toutes), pour l'écran de rattachement. */
export async function listSiteActionsForAttach(siteId: string): Promise<ScopeActionRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_actions')
    .select('id, title, body, corps_etat, status, created_at, scope_id')
    .eq('site_id', siteId)
    .in('status', ['open', 'planned', 'done'])
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    corpsEtat: (r.corps_etat as string | null) ?? null,
    status: r.status as SiteActionStatus,
    createdAt: r.created_at as string,
    scopeId: (r.scope_id as string | null) ?? null,
  }))
}

/** Rattache (scopeId) ou dé-rattache (null) une action. Vérifie l'org via le site. */
export async function setActionScope(input: {
  actionId: string
  scopeId: string | null
  orgId: string
}): Promise<void> {
  const supabase = createAdminClient()
  // L'action existe et son site appartient à l'org.
  const { data: action } = await supabase
    .from('site_actions')
    .select('id, site_id')
    .eq('id', input.actionId)
    .maybeSingle()
  if (!action) throw new Error('Action introuvable')
  const actionSiteId = (action as { site_id: string }).site_id
  const { data: site } = await supabase
    .from('sites')
    .select('id, organization_id')
    .eq('id', actionSiteId)
    .maybeSingle()
  if (!site || (site as { organization_id: string }).organization_id !== input.orgId) {
    throw new Error('Action hors de cette organisation')
  }
  // Si rattachement : le scope doit être dans l'org ET sur le même site.
  if (input.scopeId) {
    const scope = await getScope(input.scopeId, input.orgId)
    if (!scope || scope.siteId !== actionSiteId) {
      throw new Error('Sous-périmètre invalide pour ce site')
    }
  }
  const { error } = await supabase
    .from('site_actions')
    .update({ scope_id: input.scopeId })
    .eq('id', input.actionId)
  if (error) throw error
}
