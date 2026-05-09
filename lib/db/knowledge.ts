import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbKnowledgeItem, KnowledgeCategory } from '@/types/db'

export interface KnowledgeQuery {
  category?: KnowledgeCategory
  tags?: string[]        // any-of match
  search?: string        // full-text on title + content_markdown
}

/**
 * Liste les items de bibliothèque non supprimés.
 * Filtres optionnels par catégorie / tags / recherche full-text.
 * Lecture standard via le client serveur (RLS-protected, manager+admin only).
 */
export async function listKnowledgeItems(query: KnowledgeQuery = {}): Promise<DbKnowledgeItem[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('knowledge_items')
    .select('id, title, category, content_markdown, file_path, tags, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.category) q = q.eq('category', query.category)
  if (query.tags && query.tags.length > 0) q = q.overlaps('tags', query.tags)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,content_markdown.ilike.%${s}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbKnowledgeItem[]
}

/**
 * Récupère un item par id (incluant soft-deleted, pour pouvoir l'éditer/restaurer).
 */
export async function getKnowledgeItem(id: string): Promise<DbKnowledgeItem | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .select('id, title, category, content_markdown, file_path, tags, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as DbKnowledgeItem
}

/**
 * Crée un nouvel item. Retourne l'id créé.
 * Service role bypass RLS (l'autorisation manager+admin est vérifiée en amont par requireManagerOrAdmin).
 */
export async function createKnowledgeItem(input: {
  title: string
  category: KnowledgeCategory
  content_markdown: string
  file_path?: string | null
  tags?: string[] | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .insert({
      title: input.title,
      category: input.category,
      content_markdown: input.content_markdown,
      file_path: input.file_path ?? null,
      tags: input.tags ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id returned')
  return data.id
}

/**
 * Met à jour un item existant (champs partiels).
 */
export async function updateKnowledgeItem(
  id: string,
  fields: Partial<{
    title: string
    category: KnowledgeCategory
    content_markdown: string
    file_path: string | null
    tags: string[] | null
  }>
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('knowledge_items').update(fields).eq('id', id)
  if (error) throw error
}

/**
 * Soft delete : pose `deleted_at = now()`.
 */
export async function softDeleteKnowledgeItem(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('knowledge_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Liste les tags distincts utilisés dans la bibliothèque (pour le filtre).
 * Renvoie un tableau de strings unique, trié alphabétiquement.
 */
export async function listAllTags(): Promise<string[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .select('tags')
    .is('deleted_at', null)
    .not('tags', 'is', null)
  if (error) throw error
  const set = new Set<string>()
  for (const row of data ?? []) {
    for (const t of (row.tags as string[] | null) ?? []) set.add(t)
  }
  return Array.from(set).sort()
}
