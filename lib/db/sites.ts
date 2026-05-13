import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { DbSite, DbSiteNote } from '@/types/db'

export async function listSites(): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function listSitesByContract(contractId: string): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function updateSite(
  id: string,
  patch: { name?: string; address?: string | null; notes?: string | null },
): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.address !== undefined) update.address = patch.address
  if (patch.notes !== undefined) update.notes = patch.notes
  if (Object.keys(update).length === 0) return
  const { error } = await supabase
    .from('sites')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw error
}

export async function createSite(input: {
  client_id: string
  contract_id: string | null
  name: string
  address?: string | null
  notes?: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .insert({
      client_id: input.client_id,
      contract_id: input.contract_id,
      name: input.name,
      address: input.address ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// =================================
// Mémoire des lieux — Sprint 2 doctrine V5
//
// Notes courtes vivantes par site (140 chars max).
// Format descriptif passif uniquement — verrou V4 (pas de « Pense à... »,
// « Attention à... ») et verrou V5 (édition contrainte, pas un mini-CMS).
// =================================

const DEFAULT_NOTE_LIMIT = 10

/**
 * Liste les notes actives (non-soft-deleted) d'un site, triées par date desc.
 * Limite par défaut : 10. La page mobile affiche 3-5.
 */
export async function listSiteNotes(siteId: string, limit?: number): Promise<DbSiteNote[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_notes')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, limit ?? DEFAULT_NOTE_LIMIT))
  if (error) throw error
  return (data ?? []) as DbSiteNote[]
}

/**
 * Crée une note courte sur un site. Body trimé puis validé 3-140 chars.
 * `created_by` est récupéré du contexte auth — sans user → throws (la policy
 * INSERT exige created_by = auth.uid()).
 *
 * Doctrine V5 : édition contrainte. Pas de wording managérial côté UI ; la
 * validation backend reste neutre (contrainte de longueur uniquement, pas de
 * lexique imposé sur le contenu — le système ne juge pas les mots de l'humain).
 */
export async function createSiteNote(input: {
  siteId: string
  body: string
}): Promise<DbSiteNote> {
  const trimmed = input.body.trim()
  if (trimmed.length < 3) {
    throw new Error('Note trop courte (3 caractères minimum)')
  }
  if (trimmed.length > 140) {
    throw new Error('Note trop longue (140 caractères maximum)')
  }

  // Récupère l'utilisateur authentifié pour created_by (cohérent avec la RLS).
  const server = await createServerClient()
  const { data: { user } } = await server.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Admin client pour l'insert (bypass RLS — l'auth a déjà été vérifiée).
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_notes')
    .insert({
      site_id: input.siteId,
      body: trimmed,
      created_by: user.id,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DbSiteNote
}

/**
 * Soft-delete d'une note (deleted_at = now()). N'affecte que les notes encore
 * actives — un nouveau call sur une note déjà supprimée est idempotent.
 */
export async function softDeleteSiteNote(noteId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId)
    .is('deleted_at', null)
  if (error) throw error
}
