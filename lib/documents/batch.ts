// Import par lot — logique PURE (testable, sans server-only).
// Vincent 2026-05-23. Cf. [[ingestion-memorielle-pipeline]] (Phase 2 V1).

import { classifyDocument, guessDocumentType, type DocClassification } from './classify'

export interface BatchRow {
  filename: string
  /** Type deviné par le nom de fichier (éditable ensuite par l'humain). */
  documentType: string
  /** Classification initiale (couche dérivée + reco d'indexation + raison). */
  classification: DocClassification
}

/** Pré-tri LOCAL (sans upload) : chaque fichier → type deviné + classification. */
export function buildBatchRows(filenames: string[]): BatchRow[] {
  return filenames.map((filename) => {
    const documentType = guessDocumentType(filename)
    return {
      filename,
      documentType,
      classification: classifyDocument({ documentType, filename }),
    }
  })
}

/**
 * Exécute `fn` sur chaque item avec une concurrence BORNÉE (queue n-par-n) —
 * jamais Promise.all(50). `fn` ne doit pas throw (l'appelant gère ok/erreur) :
 * un échec n'interrompt pas les autres (import partiel). Résultats ordonnés.
 */
export async function runPool<T, R>(
  items: T[],
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
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  await Promise.all(workers)
  return results
}
