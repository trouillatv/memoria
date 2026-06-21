// lib/db/glossary.ts
//
// Glossaire métier (mig 150) : terme / définition / alias, par organisation.
// Référentiel manuel V1 — destiné à nourrir les corrections de transcription
// (« finisher » → « finisseur »). Pas de LLM, pas de RAG.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

export interface GlossaryTerm {
  id: string
  term: string
  definition: string | null
  aliases: string[]
  createdAt: string
}

export async function listGlossaryTerms(): Promise<GlossaryTerm[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase
    .from('glossary_terms')
    .select('id, term, definition, aliases, created_at')
    .order('term', { ascending: true })
  q = orgId ? q.eq('organization_id', orgId) : q.is('organization_id', null)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; term: string; definition: string | null; aliases: string[] | null; created_at: string }>)
    .map((r) => ({ id: r.id, term: r.term, definition: r.definition, aliases: r.aliases ?? [], createdAt: r.created_at }))
}

export async function createGlossaryTerm(input: {
  term: string
  definition?: string | null
  aliases?: string[]
  createdBy: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('glossary_terms')
    .insert({
      organization_id: orgId,
      term: input.term,
      definition: input.definition ?? null,
      aliases: input.aliases ?? [],
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/** Suppression — gardée scopée à l'organisation de l'utilisateur courant. */
export async function deleteGlossaryTerm(id: string): Promise<void> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('glossary_terms').delete().eq('id', id)
  if (orgId) q = q.eq('organization_id', orgId)
  const { error } = await q
  if (error) throw error
}
