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

/** Photos, vocaux, vidéos, PDF. Les grosses vidéos seront simplement refusées
 *  par la limite de taille (une requête de partage ne porte pas 50 Mo) — mais
 *  elles sont refusées AVEC UN MOTIF, pas exclues en silence. */
export function isShareable(mime: string): boolean {
  return (
    /^image\//.test(mime) ||
    /^audio\//.test(mime) ||
    /^video\//.test(mime) ||
    mime === 'application/pdf'
  )
}

export function isAudio(mime: string): boolean {
  return /^audio\//.test(mime)
}

/**
 * OÙ VA CE LOT — **c'est l'utilisateur qui le dit**, jamais le contenu.
 *
 * On a d'abord cru pouvoir deviner : « des vocaux → une réunion, des photos →
 * une visite ». C'est faux, et Vincent l'a tranché : **un vocal peut documenter
 * une visite de terrain ; une photo peut illustrer une réunion technique.**
 * Deviner, c'est se tromper une fois sur deux — et ranger la mémoire au mauvais
 * endroit, ce qui est pire que de poser une question.
 */
export type ShareDestination =
  | { type: 'visit'; id: string | null; title?: string | null }
  | { type: 'meeting'; id: string | null; title?: string | null }

/** Ce que contient le lot — pour le DIRE à l'utilisateur (« 3 photos, 2 vocaux »). */
export interface LotSummary {
  photos: number
  audios: number
  videos: number
  documents: number
  total: number
}

export function describeLot(mimes: string[]): LotSummary {
  const s: LotSummary = { photos: 0, audios: 0, videos: 0, documents: 0, total: mimes.length }
  for (const m of mimes) {
    if (/^image\//.test(m)) s.photos += 1
    else if (/^audio\//.test(m)) s.audios += 1
    else if (/^video\//.test(m)) s.videos += 1
    else s.documents += 1
  }
  return s
}

/** « 3 photos et 2 enregistrements » — en français, jamais « 5 fichiers ». */
export function describeLotFr(s: LotSummary): string {
  const parts: string[] = []
  if (s.photos) parts.push(`${s.photos} photo${s.photos > 1 ? 's' : ''}`)
  if (s.audios) parts.push(`${s.audios} enregistrement${s.audios > 1 ? 's' : ''}`)
  if (s.videos) parts.push(`${s.videos} vidéo${s.videos > 1 ? 's' : ''}`)
  if (s.documents) parts.push(`${s.documents} document${s.documents > 1 ? 's' : ''}`)
  if (parts.length === 0) return 'rien'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`
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
