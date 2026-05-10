import type { Source } from '@/types/sources'
import type { DbKnowledgeItem } from '@/types/db'

interface AnalysisSourcesContext {
  extractedText: string | null
  knowledgeItems: DbKnowledgeItem[]
  /** Si true (mode mock), on skip la validation pour préserver les fixtures démo */
  skipPdfValidation?: boolean
}

/**
 * Valide une liste de sources retournées par un agent IA.
 * - PDF : quote doit apparaître (substring approximative) dans extracted_text. Sinon drop.
 * - library : library_item_title doit matcher un knowledge_item. Sinon drop.
 *   Si match, on enrichit avec library_item_id et library_item_category.
 * - analysis : pas de validation, kept.
 *
 * Objectif : moins de sources mais plus crédibles.
 */
export function validateSources(
  sources: Source[],
  opts: {
    extractedText: string | null
    knowledgeItems: DbKnowledgeItem[]
  }
): Source[] {
  const result: Source[] = []
  const haystack = opts.extractedText ? normalize(opts.extractedText) : null

  for (const src of sources) {
    if (!src.quote) continue

    if (src.type === 'pdf') {
      // PDF quotes must be substantial enough to verify
      if (src.quote.length < 10) continue
      if (!haystack) continue
      const needle = normalize(src.quote)
      if (haystack.includes(needle)) {
        result.push({ ...src, verified: true })
      } else {
        // Tolerance : si les 40 premiers caractères matchent, on garde mais marque non-verified
        const prefix = needle.slice(0, 40)
        if (prefix.length >= 30 && haystack.includes(prefix)) {
          result.push({ ...src, verified: false })
        }
        // Sinon drop : on préfère pas de source à une fausse source
      }
    } else if (src.type === 'library') {
      if (!src.library_item_title) continue
      const titleNorm = src.library_item_title.trim().toLowerCase()
      const match = opts.knowledgeItems.find(
        (k) => k.title.trim().toLowerCase() === titleNorm
      )
      if (match) {
        result.push({
          ...src,
          library_item_id: match.id,
          library_item_category: match.category,
          verified: true,
        })
      }
      // Sinon drop
    } else if (src.type === 'analysis') {
      // Pas de validation possible, kept
      result.push(src)
    }
  }

  return result
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Valide les sources de chaque item dans constraints/risks/checklist.
 * Retourne un nouvel objet avec sources nettoyées (drop si invalides).
 * Si skipPdfValidation=true (mode mock), conserve toutes les sources sans validation.
 */
export function validateAnalysisSources<T extends {
  constraints?: Array<{ sources?: Source[]; [k: string]: unknown }>
  risks?: Array<{ sources?: Source[]; [k: string]: unknown }>
  checklist?: Array<{ sources?: Source[]; [k: string]: unknown }>
}>(analysis: T, ctx: AnalysisSourcesContext): T {
  const validateItems = <I extends { sources?: Source[] }>(items?: I[]): I[] | undefined => {
    if (!items) return items
    return items.map(item => {
      if (!item.sources || item.sources.length === 0) return item
      if (ctx.skipPdfValidation) return item
      return {
        ...item,
        sources: validateSources(item.sources, {
          extractedText: ctx.extractedText,
          knowledgeItems: ctx.knowledgeItems,
        }),
      }
    })
  }
  return {
    ...analysis,
    constraints: validateItems(analysis.constraints),
    risks: validateItems(analysis.risks),
    checklist: validateItems(analysis.checklist),
  }
}
