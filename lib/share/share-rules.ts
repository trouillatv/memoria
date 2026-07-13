// Ce que la porte accepte — et ce qu'elle refuse en le DISANT.
//
// Un partage qui échoue en silence est pire que pas de partage du tout :
// Guillaume croirait ses photos arrivées. Chaque refus porte donc un motif, et
// chaque motif porte une phrase (côté écran).
//
// Pur : aucune dépendance au réseau, au stockage ou à la requête.

export type ShareRejection = 'vide' | 'trop-lourd' | 'type'

export const MAX_FILES = 30
/** Au-delà, la requête de partage ne traverse pas la couche réseau. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024

/** Photos et PDF. La vidéo est trop lourde pour un partage : elle a ses propres
 *  chemins d'upload. */
export function isShareable(mime: string): boolean {
  return /^image\//.test(mime) || mime === 'application/pdf'
}

export interface ShareCandidate {
  size: number
  type: string
}

export type ShareVerdict<T> = { ok: true; files: T[] } | { ok: false; reason: ShareRejection }

/**
 * Trie ce qui arrive d'Android.
 *
 * L'ordre est CONSERVÉ : c'est celui des photos dans WhatsApp, donc souvent
 * l'ordre chronologique de la visite. Le moteur d'ingestion s'en sert.
 */
export function acceptShared<T extends ShareCandidate>(files: T[]): ShareVerdict<T> {
  const nonEmpty = files.filter((f) => f.size > 0)
  if (nonEmpty.length === 0) return { ok: false, reason: 'vide' }

  const kept = nonEmpty.slice(0, MAX_FILES)

  // La taille se juge sur ce qu'on garde réellement.
  const total = kept.reduce((n, f) => n + f.size, 0)
  if (total > MAX_TOTAL_BYTES) return { ok: false, reason: 'trop-lourd' }

  const shareable = kept.filter((f) => isShareable(f.type ?? ''))
  if (shareable.length === 0) return { ok: false, reason: 'type' }

  return { ok: true, files: shareable }
}
