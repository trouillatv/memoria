import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'
import type {
  DbTenderAnalysisConstraint,
  DbTenderAnalysisChecklistItem,
} from '@/types/db'

export type TerrainSourceType = 'anomaly' | 'site_note' | 'intervention_note'

export interface TerrainTrace {
  sourceType: TerrainSourceType
  sourceId: string
  textExcerpt: string
}

export interface TerrainMatchBySite {
  siteId: string
  siteName: string
  traces: TerrainTrace[]
}

export interface CriterionMatch {
  criterion: string
  matchBySite: TerrainMatchBySite[]
}

type RawMatch = {
  source_type: string
  source_id: string
  site_id: string
  text_excerpt: string
  similarity: number
}

async function getTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

async function resolveSiteNames(siteIds: string[]): Promise<Map<string, string>> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('id, name').in('id', siteIds)
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  )
}

function groupBySite(
  matches: RawMatch[],
  siteNameMap: Map<string, string>,
): TerrainMatchBySite[] {
  const bySite = new Map<string, { traces: TerrainTrace[]; topSimilarity: number }>()
  for (const m of matches) {
    const entry = bySite.get(m.site_id) ?? { traces: [], topSimilarity: 0 }
    entry.traces.push({
      sourceType: m.source_type as TerrainSourceType,
      sourceId: m.source_id,
      textExcerpt: m.text_excerpt,
    })
    if (m.similarity > entry.topSimilarity) entry.topSimilarity = m.similarity
    bySite.set(m.site_id, entry)
  }
  return [...bySite.entries()]
    .map(([siteId, { traces, topSimilarity }]) => ({
      siteId,
      siteName: siteNameMap.get(siteId) ?? siteId,
      traces,
      _topSimilarity: topSimilarity,
    }))
    .sort((a, b) => b._topSimilarity - a._topSimilarity)
    .map(({ _topSimilarity: _, ...rest }) => rest)
}

async function searchTenant(
  tenantId: string,
  embedding: number[],
  limit = 8,
  threshold = 0.60,
): Promise<RawMatch[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_similar_traces_for_tenant', {
    p_tenant_id: tenantId,
    p_embedding: `[${embedding.join(',')}]`,
    p_source_types: ['anomaly', 'site_note', 'intervention_note'],
    p_limit: limit,
    p_threshold: threshold,
  })
  if (error) {
    console.error('[match-ao-terrain] RPC error', JSON.stringify(error))
    return []
  }
  return (data ?? []) as RawMatch[]
}

/**
 * Matching par critère — la vraie valeur Atelier IA.
 *
 * Prend les contraintes et la checklist déjà extraites par l'IA (pas de LLM
 * supplémentaire), embède chaque critère en parallèle, cherche les traces
 * terrain concordantes dans toute la mémoire du tenant.
 *
 * Retourne uniquement les critères pour lesquels des preuves terrain existent.
 * Cap à 8 critères (required en priorité) pour limiter les appels embedding.
 */
export async function matchCriteriaToTerrain(
  tenderId: string,
  constraints: DbTenderAnalysisConstraint[] | null,
  checklist: DbTenderAnalysisChecklistItem[] | null,
): Promise<CriterionMatch[]> {
  if (getActiveProvider() === null) return []

  // Construire la liste des critères à matcher — required d'abord, cap à 8.
  const criteriaTexts: string[] = []

  const sortedConstraints = [...(constraints ?? [])].sort((a, b) =>
    (b.required ? 1 : 0) - (a.required ? 1 : 0),
  )
  for (const c of sortedConstraints) {
    if (criteriaTexts.length >= 5) break
    const text = c.detail ? `${c.label} — ${c.detail}` : c.label
    if (text.length >= 8) criteriaTexts.push(text)
  }
  for (const item of (checklist ?? []).filter((i) => i.required)) {
    if (criteriaTexts.length >= 8) break
    if (item.item.length >= 8) criteriaTexts.push(item.item)
  }

  if (criteriaTexts.length === 0) return []

  const tenantId = await getTenantId()
  if (!tenantId) return []

  // Embeddings en parallèle — 1 appel API par critère, simultanés.
  const embeddings = await Promise.all(criteriaTexts.map((t) => getEmbedding(t)))

  // Recherches terrain en parallèle.
  const rawResults = await Promise.all(
    criteriaTexts.map((_, i) => {
      const emb = embeddings[i]
      if (!emb) return Promise.resolve([] as RawMatch[])
      return searchTenant(tenantId, emb, 6)
    }),
  )

  // Résoudre les noms de sites pour tous les matches en une seule requête.
  const allSiteIds = [
    ...new Set(rawResults.flatMap((r) => r.map((m) => m.site_id))),
  ]
  const siteNameMap = allSiteIds.length > 0
    ? await resolveSiteNames(allSiteIds)
    : new Map<string, string>()

  // Assembler les résultats par critère — ne garder que ceux avec des preuves.
  return criteriaTexts
    .map((criterion, i) => ({
      criterion,
      matchBySite: groupBySite(rawResults[i], siteNameMap),
    }))
    .filter((r) => r.matchBySite.length > 0)
}

/**
 * Fallback : matching sur les 2000 premiers caractères du PDF extrait.
 * Utilisé quand aucune analyse structurée n'est disponible.
 */
export async function matchAoToTerrain(tenderId: string): Promise<TerrainMatchBySite[]> {
  if (getActiveProvider() === null) return []

  const supabase = createAdminClient()
  const { data: doc } = await supabase
    .from('tender_documents')
    .select('extracted_text')
    .eq('tender_id', tenderId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const rawText = (doc as { extracted_text?: string } | null)?.extracted_text
  if (!rawText || rawText.length < 50) return []

  const embedding = await getEmbedding(rawText.slice(0, 2000))
  if (!embedding) return []

  const tenantId = await getTenantId()
  if (!tenantId) return []

  const matches = await searchTenant(tenantId, embedding, 20)
  if (matches.length === 0) return []

  const siteIds = [...new Set(matches.map((m) => m.site_id))]
  const siteNameMap = await resolveSiteNames(siteIds)
  return groupBySite(matches, siteNameMap)
}
