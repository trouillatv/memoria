import type { EngagementSourceType, TenderPieceKind } from '@/types/db'
import { tenderPieceLabel } from '@/lib/tenders/pieces'
import type { ExtractedEngagement } from '@/services/ai/engagement-extraction'

// Orchestration de l'extraction PIÈCE PAR PIÈCE.
//
// Chaque pièce d'AO est lue en ENTIER dans sa propre passe (source_type
// ao_clause, tender_document_id connu) ; le mémoire technique généré est une
// passe distincte (source_type memoire_engagement). On ne mélange jamais une
// exigence d'AO avec une proposition rédigée par l'IA.

export interface ExtractionSource {
  sourceText: string
  sourceType: EngagementSourceType
  tenderDocumentId: string | null
  sourceLabel: string
}

export interface ExtractionDoc {
  id: string
  filename: string
  kind: TenderPieceKind | null
  extractedText: string | null
}

/**
 * Une source par pièce LISIBLE (texte non vide) + une source pour le mémoire
 * technique s'il existe. Les pièces sans texte (plan sans OCR, extraction
 * échouée) sont ignorées : mieux vaut leur absence qu'une passe vide.
 */
export function buildExtractionSources(
  docs: ReadonlyArray<ExtractionDoc>,
  technicalMemo: string | null,
): ExtractionSource[] {
  const sources: ExtractionSource[] = []
  for (const d of docs) {
    if (!d.extractedText || d.extractedText.trim().length === 0) continue
    sources.push({
      sourceText: d.extractedText,
      sourceType: 'ao_clause',
      tenderDocumentId: d.id,
      sourceLabel: `${tenderPieceLabel(d.kind)} — ${d.filename}`,
    })
  }
  if (technicalMemo && technicalMemo.trim().length > 0) {
    sources.push({
      sourceText: technicalMemo,
      sourceType: 'memoire_engagement',
      tenderDocumentId: null,
      sourceLabel: 'Mémoire technique proposé',
    })
  }
  return sources
}

/**
 * map à concurrence BORNÉE : au plus `limit` exécutions simultanées, résultats
 * dans l'ordre des items. Évite les pics de charge / quotas / timeouts quand on
 * lance N+1 passes IA d'un coup.
 */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

export type OrchestratedEngagement = ExtractedEngagement & { page_number: number | null }

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('fr').replace(/\s+/gu, ' ').trim()
}

/**
 * Déduplication idempotente. Identité = (document, type de source, libellé
 * normalisé). Conséquences voulues :
 * - un doublon dans la MÊME pièce est fusionné ;
 * - la même clause présente dans DEUX pièces reste deux engagements (chacun
 *   attribué à sa pièce — c'est une information, pas un doublon) ;
 * - une exigence d'AO et une proposition du mémoire de même libellé restent
 *   distinctes (types de source différents).
 */
export function dedupeEngagements<T extends {
  tender_document_id: string | null
  source_type: EngagementSourceType
  short_label: string
}>(items: ReadonlyArray<T>): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const e of items) {
    const key = `${e.tender_document_id ?? 'memo'}|${e.source_type}|${normalizeKey(e.short_label)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}
