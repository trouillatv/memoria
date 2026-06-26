// lib/db/glossary.ts
//
// Glossaire métier (mig 150) : terme / définition / alias, par organisation.
// Référentiel manuel V1 — destiné à nourrir les corrections de transcription
// (« finisher » → « finisseur »). Pas de LLM, pas de RAG.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { DEFAULT_GLOSSARY } from './glossary-seed'

// Re-export pour compat (les appelants serveur peuvent garder l'import depuis ici).
// La constante VIT dans glossary-constants.ts (sans dépendance serveur) pour que
// les composants client l'importent SANS tirer ce module serveur dans leur bundle.
export { GLOSSARY_CATEGORIES } from './glossary-constants'

export interface GlossaryTerm {
  id: string
  term: string
  definition: string | null
  /** Catégorie métier (mig 152) : engin / matériau / document / processus / contrôle… */
  category: string | null
  aliases: string[]
  createdAt: string
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Correction déterministe d'un texte par le glossaire (pas de LLM) : chaque
 * alias est remplacé par le terme canonique (mot entier, insensible à la casse).
 * Ex. « finisher » → « finisseur ». Les alias les plus longs d'abord (évite les
 * remplacements partiels). Fonction PURE — testable, sans dépendance serveur.
 */
export function applyGlossaryCorrections(text: string, terms: GlossaryTerm[]): string {
  if (!text) return text
  const pairs: Array<{ alias: string; term: string }> = []
  for (const t of terms) {
    for (const a of t.aliases) {
      const alias = a.trim()
      if (alias && alias.toLowerCase() !== t.term.toLowerCase()) pairs.push({ alias, term: t.term })
    }
  }
  // Alias les plus longs d'abord : « grave bitume » avant « grave ».
  pairs.sort((x, y) => y.alias.length - x.alias.length)
  let out = text
  for (const { alias, term } of pairs) {
    out = out.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, 'gi'), term)
  }
  return out
}

/**
 * Bloc « vocabulaire métier » compact pour les prompts LLM : le glossaire ne sert
 * plus seulement à corriger l'orthographe (déterministe), il DONNE LE SENS des
 * termes au modèle (acronymes, jargon, vocabulaire maison) → il les comprend, ne
 * les redéfinit pas. Org-scopé, BORNÉ (coût), best-effort (jamais bloquant).
 * Priorité aux termes définis ; alias inclus pour que le modèle relie les variantes.
 */
export async function buildGlossaryPromptBlock(maxChars = 2500): Promise<string> {
  let terms: GlossaryTerm[]
  try { terms = await listGlossaryTerms() } catch { return '' }
  if (terms.length === 0) return ''
  // Termes définis d'abord (sens le plus utile au modèle).
  const ordered = [...terms].sort((a, b) => (b.definition ? 1 : 0) - (a.definition ? 1 : 0))
  const lines: string[] = []
  let used = 0
  for (const t of ordered) {
    const def = (t.definition ?? '').trim()
    const defShort = def.length > 120 ? `${def.slice(0, 119)}…` : def
    const aliasPart = t.aliases.length ? ` (variantes : ${t.aliases.slice(0, 4).join(', ')})` : ''
    const line = defShort ? `- ${t.term}${aliasPart} : ${defShort}` : `- ${t.term}${aliasPart}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line); used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `Vocabulaire métier de l'entreprise (comprends ces termes et leurs variantes, ne les redéfinis pas) :\n${lines.join('\n')}`
}

export async function listGlossaryTerms(): Promise<GlossaryTerm[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase
    .from('glossary_terms')
    .select('id, term, definition, category, aliases, created_at')
    .order('term', { ascending: true })
  q = orgId ? q.eq('organization_id', orgId) : q.is('organization_id', null)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; term: string; definition: string | null; category: string | null; aliases: string[] | null; created_at: string }>)
    .map((r) => ({ id: r.id, term: r.term, definition: r.definition, category: r.category, aliases: r.aliases ?? [], createdAt: r.created_at }))
}

export async function createGlossaryTerm(input: {
  term: string
  definition?: string | null
  category?: string | null
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
      category: input.category ?? null,
      aliases: input.aliases ?? [],
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Charge le vocabulaire métier de démarrage (BTP/VRD + MOE) pour l'organisation
 * courante. IDEMPOTENT : ne réinsère pas un terme déjà présent (comparaison
 * insensible à la casse). Renvoie le nombre de termes effectivement ajoutés.
 */
export async function seedDefaultGlossary(createdBy: string | null): Promise<{ inserted: number; skipped: number }> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const existing = await listGlossaryTerms()
  const have = new Set(existing.map((t) => t.term.trim().toLowerCase()))
  const toInsert = DEFAULT_GLOSSARY.filter((t) => !have.has(t.term.trim().toLowerCase()))
  if (toInsert.length === 0) return { inserted: 0, skipped: DEFAULT_GLOSSARY.length }
  const { error } = await supabase.from('glossary_terms').insert(
    toInsert.map((t) => ({
      organization_id: orgId,
      term: t.term,
      definition: t.definition,
      category: t.category,
      aliases: t.aliases,
      created_by: createdBy,
    })),
  )
  if (error) throw error
  return { inserted: toInsert.length, skipped: DEFAULT_GLOSSARY.length - toInsert.length }
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
