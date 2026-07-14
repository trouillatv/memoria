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
        // Le dossier d'AO est LU EN ENTIER : le corpus concatène les pièces, et
        // chacune redémarre à [[page 1]]. On retrouve donc la pièce, et la page
        // DANS cette pièce — au lieu de laisser l'agent deviner un numéro qui,
        // seul, ne désigne plus rien.
        const located = locateQuote(opts.extractedText!, needle)
        result.push({
          ...src,
          ...(located.document ? { document: located.document } : {}),
          ...(located.page !== undefined ? { page: located.page } : {}),
          verified: true,
        })
      } else {
        // Tolerance : si les 40 premiers caractères matchent, on garde mais marque non-verified
        const prefix = needle.slice(0, 40)
        if (prefix.length >= 30 && haystack.includes(prefix)) {
          const located = locateQuote(opts.extractedText!, prefix)
          result.push({
            ...src,
            ...(located.document ? { document: located.document } : {}),
            ...(located.page !== undefined ? { page: located.page } : {}),
            verified: false,
          })
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
 * OÙ, EXACTEMENT ? — la pièce, puis la page DANS cette pièce.
 *
 * Le corpus d'un appel d'offres est la concaténation de toutes ses pièces, chacune
 * introduite par « === CCTP — cctp.pdf === » (cf. buildTenderCorpus). Et chaque
 * pièce redémarre à [[page 1]] : « page 7 » ne désigne donc plus rien tant qu'on
 * n'a pas dit DE QUELLE pièce il s'agit.
 *
 * On ne le demande pas à l'agent : on le CHERCHE. Une provenance devinée n'est pas
 * une provenance — et au clic, une page fausse détruit la confiance.
 *
 * Un dossier mono-pièce (pas d'en-tête) reste traité comme avant : pas de document,
 * page relative au document unique.
 */
const PIECE_HEADER = /^=== (.+) ===$/gm
const PAGE_MARKER = /\[\[page (\d+)\]\]/

export function locateQuote(
  corpus: string,
  normalizedNeedle: string,
): { document?: string; page?: number } {
  // 1) Découper le corpus en pièces, par leurs en-têtes.
  const pieces: Array<{ label: string | null; text: string }> = []
  const headers = [...corpus.matchAll(PIECE_HEADER)]

  if (headers.length === 0) {
    pieces.push({ label: null, text: corpus })
  } else {
    // Ce qui précède le premier en-tête (rare, mais ne doit pas disparaître).
    const firstAt = headers[0]!.index ?? 0
    if (firstAt > 0) pieces.push({ label: null, text: corpus.slice(0, firstAt) })

    headers.forEach((h, i) => {
      const start = (h.index ?? 0) + h[0].length
      const end = i + 1 < headers.length ? (headers[i + 1]!.index ?? corpus.length) : corpus.length
      pieces.push({ label: h[1]!.trim(), text: corpus.slice(start, end) })
    })
  }

  // 2) Dans quelle pièce la citation vit-elle ?
  for (const piece of pieces) {
    if (!normalize(piece.text).includes(normalizedNeedle)) continue
    const page = pageWithin(piece.text, normalizedNeedle)
    return {
      ...(piece.label ? { document: piece.label } : {}),
      ...(page !== undefined ? { page } : {}),
    }
  }
  return {}
}

/** La page DANS la pièce — le marqueur [[page N]] qui précède la citation. */
function pageWithin(pieceText: string, normalizedNeedle: string): number | undefined {
  const parts = pieceText.split(new RegExp(PAGE_MARKER.source, 'g'))
  // parts = [avant, "1", corps1, "2", corps2, …]
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i])
    const body = parts[i + 1] ?? ''
    if (!Number.isFinite(n)) continue
    if (normalize(body).includes(normalizedNeedle)) return n
  }
  return undefined
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
