import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmbedding, getActiveProvider } from './embeddings'
import { canViewDocument } from '@/lib/documents/access'
import type { UserRole, DocumentVisibility } from '@/types/db'

type SourceDomain = 'library' | 'tender_history' | 'document'

export interface KnowledgeChunkMatch {
  sourceDomain: SourceDomain
  sourceType: string
  sourceId: string
  chunkText: string
  metadata: Record<string, unknown>
}

export interface KnowledgeMatchBySource {
  sourceDomain: SourceDomain
  sourceId: string
  label: string
  chunks: KnowledgeChunkMatch[]
}

type RawKnowledgeMatch = {
  source_domain: string
  source_type: string
  source_id: string
  chunk_index: number
  chunk_text: string
  metadata: Record<string, unknown>
  similarity: number
}

async function getTenantId(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('sites').select('tenant_id').limit(1).maybeSingle()
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null
}

function buildSourceLabel(match: RawKnowledgeMatch): string {
  const meta = match.metadata ?? {}
  if (match.source_domain === 'document') {
    // Lien source conservé : [doc:id] → ré-ouvrable /documents/<id>
    // (cohérent avec A1, prompts agents). Jamais de scoring/fiche personne.
    const t = meta.document_type as string | undefined
    return `Document [doc:${match.source_id}]${t ? ` · ${t}` : ''}`
  }
  if (match.source_domain === 'library') {
    return (meta.title as string | undefined) ?? 'Document bibliothèque'
  }
  const title = (meta.title as string | undefined) ?? 'AO'
  const outcome = meta.outcome === 'won' ? 'Gagné'
    : meta.outcome === 'lost' ? 'Perdu'
    : String(meta.outcome ?? '')
  const parts = [
    outcome,
    meta.client as string | undefined,
    (meta.year as number | undefined)?.toString(),
  ].filter(Boolean)
  return `${title}${parts.length > 0 ? ` (${parts.join(' — ')})` : ''}`
}

function groupBySource(matches: RawKnowledgeMatch[]): KnowledgeMatchBySource[] {
  const bySource = new Map<string, { firstMatch: RawKnowledgeMatch; chunks: KnowledgeChunkMatch[] }>()

  for (const m of matches) {
    const key = `${m.source_domain}:${m.source_id}`
    const entry = bySource.get(key) ?? { firstMatch: m, chunks: [] }
    entry.chunks.push({
      sourceDomain: m.source_domain as SourceDomain,
      sourceType: m.source_type,
      sourceId: m.source_id,
      chunkText: m.chunk_text,
      metadata: m.metadata,
    })
    bySource.set(key, entry)
  }

  return [...bySource.values()].map(({ firstMatch, chunks }) => ({
    sourceDomain: firstMatch.source_domain as SourceDomain,
    sourceId: firstMatch.source_id,
    label: buildSourceLabel(firstMatch),
    chunks,
  }))
}

export interface OrgKnowledgeHit {
  sourceDomain: SourceDomain
  sourceId: string
  label: string
  snippet: string
  similarity: number
}

/**
 * P7+ — recherche dans la mémoire DOCUMENTAIRE (bibliothèque + AO passés +
 * documents) pour « Interroger l'entreprise ». Visibilité des documents
 * respectée AU RECALL (canViewDocument) ; library / tender_history = savoir
 * entreprise (non filtré). Dédup par source, meilleure similarité gardée.
 */
export async function searchKnowledgeForOrg(params: {
  tenantId: string
  queryEmbedding: number[]
  role: UserRole | null
  limit?: number
}): Promise<OrgKnowledgeHit[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_similar_knowledge_chunks', {
    p_tenant_id: params.tenantId,
    p_embedding: `[${params.queryEmbedding.join(',')}]`,
    p_source_domains: ['library', 'tender_history', 'document'],
    p_limit: params.limit ?? 12,
    p_threshold: 0.55,
  })
  if (error) {
    console.error('[searchKnowledgeForOrg] RPC error', JSON.stringify(error))
    return []
  }
  const visible = ((data ?? []) as RawKnowledgeMatch[]).filter((m) => {
    if (m.source_domain !== 'document') return true
    const lvl = (m.metadata?.visibility_level as DocumentVisibility) ?? 'manager'
    return canViewDocument(params.role, lvl)
  })
  const bySource = new Map<string, OrgKnowledgeHit>()
  for (const m of visible) {
    const key = `${m.source_domain}:${m.source_id}`
    const existing = bySource.get(key)
    if (existing) { existing.similarity = Math.max(existing.similarity, m.similarity); continue }
    const title = (m.metadata?.title as string | undefined) ?? null
    const label = m.source_domain === 'library' ? (title ?? 'Bibliothèque')
      : m.source_domain === 'tender_history' ? (title ?? 'AO passé')
      : (title ?? 'Document')
    bySource.set(key, {
      sourceDomain: m.source_domain as SourceDomain,
      sourceId: m.source_id,
      label,
      snippet: m.chunk_text,
      similarity: m.similarity,
    })
  }
  return [...bySource.values()].sort((a, b) => b.similarity - a.similarity)
}

// ── S4a-2 : recall documentaire SCOPÉ AU SITE ───────────────────────────────
//
// Périmètre (b, décision Vincent 2026-06-19) : documents LIÉS au site
// (document_links target='site') + documents ORG-WIDE de type contractuel /
// procédure / référence NON rattachés à un site précis (un CCTP-type ou une
// procédure interne est déterminant même sans lien chantier). Garde-fous durs :
// visibilité (canViewDocument), litige TOUJOURS exclu, jamais hors tenant.
// Citation = nom du document (filename) + extrait + lien /documents/<id>.
const ORG_WIDE_DOC_TYPES = new Set(['contrat', 'procedure', 'protocole', 'reference', 'ao'])

export interface SiteKnowledgeHit {
  documentId: string
  filename: string
  documentType: string
  snippet: string
  similarity: number
  occurredAt: string | null
}

export async function searchKnowledgeForSite(params: {
  tenantId: string
  siteId: string
  queryEmbedding: number[]
  role: UserRole | null
  limit?: number
}): Promise<SiteKnowledgeHit[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_similar_knowledge_chunks', {
    p_tenant_id: params.tenantId,
    p_embedding: `[${params.queryEmbedding.join(',')}]`,
    p_source_domains: ['document'], // S4a-2 : documents uploadés uniquement
    p_limit: params.limit ?? 12,
    p_threshold: 0.55,
  })
  if (error) {
    console.error('[searchKnowledgeForSite] RPC error', JSON.stringify(error))
    return []
  }
  const rows = (data ?? []) as RawKnowledgeMatch[]
  const docIds = [...new Set(rows.map((r) => r.source_id))]
  if (docIds.length === 0) return []

  // Métadonnées AUTORITATIVES (filename/type/visibilité/date) depuis documents,
  // pas le metadata du chunk (qui peut ne pas porter le filename).
  const meta = new Map<string, { filename: string; type: string; vis: DocumentVisibility; date: string | null }>()
  const linkedThisSite = new Set<string>()
  const linkedAnySite = new Set<string>()

  const [{ data: docs }, { data: links }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, filename, document_type, visibility_level, effective_date, created_at, deleted_at')
      .in('id', docIds),
    supabase
      .from('document_links')
      .select('document_id, target_id')
      .eq('target_type', 'site')
      .in('document_id', docIds),
  ])

  for (const d of (docs ?? []) as Array<{
    id: string; filename: string; document_type: string; visibility_level: DocumentVisibility
    effective_date: string | null; created_at: string; deleted_at: string | null
  }>) {
    if (d.deleted_at) continue
    meta.set(d.id, { filename: d.filename, type: d.document_type, vis: d.visibility_level, date: d.effective_date ?? d.created_at })
  }
  for (const l of (links ?? []) as Array<{ document_id: string; target_id: string }>) {
    linkedAnySite.add(l.document_id)
    if (l.target_id === params.siteId) linkedThisSite.add(l.document_id)
  }

  const bySource = new Map<string, SiteKnowledgeHit>()
  for (const r of rows) {
    const m = meta.get(r.source_id)
    if (!m) continue // supprimé / introuvable
    if (m.type === 'litige') continue // jamais de lecture auto d'un litige
    if (!canViewDocument(params.role, m.vis)) continue // visibilité au recall
    const keep = linkedThisSite.has(r.source_id) || (!linkedAnySite.has(r.source_id) && ORG_WIDE_DOC_TYPES.has(m.type))
    if (!keep) continue
    const key = r.source_id
    const ex = bySource.get(key)
    if (ex) { ex.similarity = Math.max(ex.similarity, r.similarity); continue }
    bySource.set(key, {
      documentId: r.source_id,
      filename: m.filename,
      documentType: m.type,
      snippet: r.chunk_text,
      similarity: r.similarity,
      occurredAt: m.date,
    })
  }
  return [...bySource.values()].sort((a, b) => b.similarity - a.similarity).slice(0, params.limit ?? 12)
}

/**
 * Matche un AO contre la mémoire documentaire du tenant : bibliothèque + AO
 * passés + documents (source_domain='document', A2).
 *
 * `role` (défaut null) borne la visibilité des chunks DOCUMENT via
 * canViewDocument : sans rôle fourni, AUCUN chunk document n'est retourné
 * (pas de fuite). library/tender_history = savoir entreprise, non concernés.
 * Retourne [] si pas de provider embedding ou pas de texte extrait.
 */
export async function matchAoToKnowledge(
  tenderId: string,
  role: UserRole | null = null,
): Promise<KnowledgeMatchBySource[]> {
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

  const [embedding, tenantId] = await Promise.all([
    getEmbedding(rawText.slice(0, 2000)),
    getTenantId(),
  ])
  if (!embedding || !tenantId) return []

  const { data, error } = await supabase.rpc('find_similar_knowledge_chunks', {
    p_tenant_id: tenantId,
    p_embedding: `[${embedding.join(',')}]`,
    p_source_domains: ['library', 'tender_history', 'document'],
    p_limit: 15,
    p_threshold: 0.55,
  })
  if (error) {
    console.error('[match-ao-knowledge] RPC error', JSON.stringify(error))
    return []
  }
  const raw = (data ?? []) as RawKnowledgeMatch[]
  if (raw.length === 0) return []

  // visibility_level respecté AU RECALL : un chunk document n'est conservé
  // que si le rôle appelant peut le voir (canViewDocument). library /
  // tender_history = savoir entreprise, non filtrés. Sans rôle → 0 document.
  const matches = raw.filter((m) => {
    if (m.source_domain !== 'document') return true
    const lvl = (m.metadata?.visibility_level as DocumentVisibility) ?? 'manager'
    return canViewDocument(role, lvl)
  })
  if (matches.length === 0) return []

  return groupBySource(matches)
}
