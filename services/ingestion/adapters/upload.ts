import 'server-only'

// Adaptateur UPLOAD (multi-fichiers) — le JUMEAU du ZIP WhatsApp (mig 184). On le
// livre en même temps pour PROUVER que le moteur est universel et pas « spécial
// WhatsApp » : glisser un dossier de photos/vocaux, ou les partager, alimente
// EXACTEMENT le même moteur. Ici l'instant réel vient du `lastModified` du fichier
// (le navigateur ne donne pas l'EXIF sans lib) ; à défaut, l'ordre reçu.

import type { IngestItem, IngestKind } from '../types'

function kindFor(mime: string, filename: string): IngestKind | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(ext)) return 'photo'
  if (mime.startsWith('video/') || ['mp4', 'mov', '3gp', 'mkv', 'avi', 'webm'].includes(ext)) return 'video'
  if (mime.startsWith('audio/') || ['opus', 'ogg', 'm4a', 'mp3', 'aac', 'amr', 'wav'].includes(ext)) return 'vocal'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  return null
}

export interface UploadFile {
  filename: string
  mime: string
  bytes: Uint8Array
  /** `File.lastModified` (ms epoch) — meilleure approximation de l'instant réel. */
  lastModifiedMs: number | null
}

/** Convertit un lot de fichiers uploadés → items. Ignore les formats non supportés. */
export function parseUpload(files: UploadFile[]): IngestItem[] {
  const items: IngestItem[] = []
  for (const f of files) {
    const kind = kindFor(f.mime, f.filename)
    if (!kind) continue
    items.push({
      bytes: f.bytes,
      filename: (f.filename.split('/').pop() ?? f.filename).slice(0, 200),
      mime: f.mime || 'application/octet-stream',
      kind,
      capturedAt: f.lastModifiedMs ? new Date(f.lastModifiedMs).toISOString() : null,
    })
  }
  return items
}
