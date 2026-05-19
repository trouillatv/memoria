// Budget de contexte documentaire — helpers PURS, sans `server-only` (donc
// testables hors runtime serveur). Le verrou « context budget » de la
// discipline coût IA vit ici ; `document-context.ts` (server-only) les
// réutilise. Aucune dépendance, aucun I/O.

export const MAX_RETRIEVED_CHUNKS = 6
export const MAX_CONTEXT_TOKENS = 1200

export interface DocChunk {
  sourceId: string
  text: string
  similarity: number
  /** A3 — type du document (déjà dans le metadata du chunk, zéro requête).
   *  Titre/collection « si disponible » : absents du metadata → omis. */
  documentType?: string
}

/** Estimation tokens volontairement grossière mais STABLE (~4 char/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Sélectionne, dans l'ordre de pertinence, le plus de chunks possible SOUS
 * le plafond de tokens. Pur, déterministe. Aucun appelant ne peut dépasser
 * ce budget — c'est le verrou opposable.
 */
export function clampChunksToBudget(
  chunks: DocChunk[],
  maxTokens: number = MAX_CONTEXT_TOKENS,
): { kept: DocChunk[]; truncated: boolean } {
  const kept: DocChunk[] = []
  let used = 0
  for (const c of chunks) {
    const t = estimateTokens(c.text)
    if (used + t > maxTokens) return { kept, truncated: true }
    kept.push(c)
    used += t
  }
  return { kept, truncated: false }
}

/** Bloc de prompt borné. Chaque extrait porte sa source → relisible via
 *  /documents/<id> (jamais le storage_path, jamais le document entier). */
export function toPromptBlock(kept: DocChunk[], truncated: boolean): string {
  if (kept.length === 0) return ''
  const head =
    '=== Documents (extraits ciblés — relire la source : /documents/<id>) ==='
  const body = kept
    .map(
      (c) =>
        `- [doc:${c.sourceId}]${c.documentType ? ` · ${c.documentType}` : ''} ${c.text.trim()}`,
    )
    .join('\n')
  const tail = truncated ? '\n(budget atteint — extraits tronqués)' : ''
  return `${head}\n${body}${tail}`
}
