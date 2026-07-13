'use server'

// Import d'une visite (mig 184) — la 2ᵉ PORTE. Le sous-traitant continue comme
// aujourd'hui (il envoie ses photos/vocaux) ; le conducteur choisit un ZIP
// WhatsApp (ou un lot de fichiers) et retombe sur le MÊME tri que la visite en
// direct. Cette action ne fait que : authentifier → scoper le site → appeler le
// bon adaptateur → passer la main au moteur. Cf. docs/ingestion-engine.md.

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOwned } from '@/lib/auth/ownership'
import { ingestBatch } from '@/services/ingestion/ingest-batch'
import { parseWhatsappZip } from '@/services/ingestion/adapters/whatsapp-zip'
import { parseUpload, type UploadFile } from '@/services/ingestion/adapters/upload'
import type { IngestItem, IngestSource } from '@/services/ingestion/types'

// Cap aligné sur serverActions.bodySizeLimit (20 Mo). Un export volumineux passera
// plus tard par l'upload signé (même contournement que la vidéo) — noté au backlog.
const MAX_BATCH_BYTES = 19 * 1024 * 1024

const schema = z.object({
  site_id: z.string().uuid(),
  source: z.enum(['whatsapp_zip', 'upload']),
})

export interface ImportResult {
  ok: true
  sessions: Array<{ reportId: string; startedAt: string; captureCount: number }>
  created: number
  skippedDuplicates: number
  /** Ce que le lot contenait — pour l'écran de reconstruction (« 28 captures… »). */
  detected: { total: number; photos: number; videos: number; vocals: number; pdf: number }
}

export async function importVisitAction(
  formData: FormData,
): Promise<ImportResult | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = schema.safeParse({ site_id: formData.get('site_id'), source: formData.get('source') })
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const { site_id, source } = parsed.data

  // Scope org (Lot S) : on n'importe que dans un chantier de son organisation.
  // Même garde que partout ailleurs — cf. lib/auth/ownership.ts.
  const owned = await requireOwned(auth.role, 'sites', site_id)
  if (!owned.allowed) return { ok: false, error: owned.error }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { ok: false, error: 'Aucun fichier' }
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_BATCH_BYTES) {
    return { ok: false, error: 'Lot trop volumineux (max 19 Mo pour l’instant). Réduisez la sélection.' }
  }

  let items: IngestItem[]
  try {
    if (source === 'whatsapp_zip') {
      const buf = Buffer.from(await files[0].arrayBuffer())
      items = parseWhatsappZip(buf)
    } else {
      const uploads: UploadFile[] = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          mime: f.type,
          bytes: new Uint8Array(await f.arrayBuffer()),
          lastModifiedMs: f.lastModified || null,
        })),
      )
      items = parseUpload(uploads)
    }
  } catch {
    return { ok: false, error: 'Lecture du lot impossible (fichier corrompu ?)' }
  }

  if (items.length === 0) {
    return { ok: false, error: 'Aucun média exploitable trouvé (photos, vidéos, vocaux, PDF).' }
  }

  const detected = {
    total: items.length,
    photos: items.filter((i) => i.kind === 'photo').length,
    videos: items.filter((i) => i.kind === 'video').length,
    vocals: items.filter((i) => i.kind === 'vocal').length,
    pdf: items.filter((i) => i.kind === 'pdf').length,
  }

  try {
    const result = await ingestBatch(items, {
      siteId: site_id,
      createdBy: auth.userId,
      source: source as IngestSource,
    })
    if (result.sessions.length === 0) {
      return { ok: false, error: 'Tout ce lot a déjà été importé.' }
    }
    return { ok: true, sessions: result.sessions, created: result.created, skippedDuplicates: result.skippedDuplicates, detected }
  } catch {
    return { ok: false, error: "Échec de l'import" }
  }
  // Les vocaux importés sont en 'pending' : le cron de rattrapage
  // (listStuckCaptureIds) les transcrit en fond, exactement comme en direct.
}
