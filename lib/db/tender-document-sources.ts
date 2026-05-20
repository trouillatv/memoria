// AO-1 L3 — Sources [doc:id] cliquables.
//
// Vincent 2026-05-21 : rendre les sources documentaires persistées dans
// `tender_analyses.document_sources` (migration 074, A6) visibles et
// cliquables vers /documents/[id].
//
// Doctrine respectée :
//   - Visibility role-gaté : un document `admin_only` reste invisible
//     pour un manager ; on le filtre AVANT exposition.
//   - Pas d'IA, pas de relecture live, pas de résumé : on ne fait QUE
//     résoudre les ids → titres + visibility.
//   - Litige : un document `document_type='litige'` ne doit JAMAIS être
//     surfacé comme « lecture automatique » (cf. [[litige-no-automatic-reading]]).
//     Ici on l'expose s'il a été utilisé comme source d'analyse — c'est
//     une trace d'usage humain (analyse passée), pas une lecture auto.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLatestTenderAnalysis } from '@/lib/db/tenders'
import { canViewDocument } from '@/lib/documents/access'
import type { UserRole, DocumentVisibility } from '@/types/db'

export interface TenderDocumentSource {
  id: string
  title: string
  /** Type connu (document_type) pour iconographie côté UI. */
  documentType: string | null
  /** Niveau de visibilité du document — utile pour distinguer un litige. */
  visibility: DocumentVisibility
  /** Type capturé au moment du recall A3 (`source_domain`/document type hint). */
  recallType: string | null
}

/**
 * Résout les `document_sources` persistées dans la dernière `tender_analyses`
 * d'un AO → titres + visibility. Filtre selon le rôle de l'appelant.
 *
 * Retourne [] silencieusement si :
 *   - pas d'analyse
 *   - pas de document_sources
 *   - aucun document encore visible pour ce rôle
 *
 * Pas d'erreur côté UI — silence positif.
 */
export async function listTenderDocumentSources(
  tenderId: string,
  role: UserRole | null,
): Promise<TenderDocumentSource[]> {
  if (!role) return []
  const analysis = await getLatestTenderAnalysis(tenderId)
  if (!analysis) return []

  const raw = (analysis as { document_sources?: unknown }).document_sources
  if (!Array.isArray(raw) || raw.length === 0) return []

  // Forme attendue : [{ id: string, type?: string }, ...]
  const sourceIds: Array<{ id: string; recallType: string | null }> = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
      sourceIds.push({
        id: (item as { id: string }).id,
        recallType: typeof (item as { type?: unknown }).type === 'string' ? (item as { type: string }).type : null,
      })
    }
  }
  if (sourceIds.length === 0) return []

  // Fetch en lot des documents avec leurs métadonnées de visibilité.
  const admin = createAdminClient()
  const { data: docs, error } = await admin
    .from('documents')
    .select('id, title, document_type, visibility_level')
    .in('id', sourceIds.map((s) => s.id))
    .is('deleted_at', null)
  if (error) throw error

  type DocRow = { id: string; title: string; document_type: string | null; visibility_level: DocumentVisibility }
  const byId = new Map<string, DocRow>()
  for (const d of (docs ?? []) as DocRow[]) byId.set(d.id, d)

  const out: TenderDocumentSource[] = []
  for (const s of sourceIds) {
    const d = byId.get(s.id)
    if (!d) continue
    if (!canViewDocument(role, d.visibility_level)) continue
    out.push({
      id: d.id,
      title: d.title,
      documentType: d.document_type,
      visibility: d.visibility_level,
      recallType: s.recallType,
    })
  }
  return out
}
