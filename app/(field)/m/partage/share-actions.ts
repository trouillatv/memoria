'use server'

// Le geste qui compte : « ces photos → ce chantier ».
//
// Rien n'est inventé ici. On relit les octets du sas et on les confie au MÊME
// moteur d'ingestion que l'import ZIP et l'upload (`ingestBatch`) — la source
// change (`os_share`), la chaîne ne change pas. Une seule chaîne, plusieurs
// portes.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireFieldAgent } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { listStaged, readStaged, clearStaged } from '@/lib/share/staging'
import { parseUpload, type UploadFile } from '@/services/ingestion/adapters/upload'
import { ingestBatch } from '@/services/ingestion/ingest-batch'

const schema = z.object({
  lotId: z.string().uuid(),
  siteId: z.string().uuid(),
})

export async function confirmShareAction(
  input: unknown,
): Promise<{ ok: true; reportId: string; count: number } | { error: string }> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return { error: 'Session expirée' }

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: 'Choisissez un chantier' }
  const { lotId, siteId } = parsed.data

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  // Le sas est scopé par utilisateur : on ne peut pas importer le lot d'un autre.
  const staged = await listStaged(auth.userId, lotId)
  if (staged.length === 0) return { error: 'Ces photos ne sont plus disponibles' }

  const uploads: UploadFile[] = []
  for (const f of staged) {
    const bytes = await readStaged(f.path)
    if (!bytes) continue
    uploads.push({
      bytes,
      filename: f.filename,
      mime: f.mime,
      lastModifiedMs: f.lastModifiedMs,
    })
  }
  if (uploads.length === 0) return { error: 'Ces photos ne sont plus disponibles' }

  const result = await ingestBatch(parseUpload(uploads), {
    siteId,
    createdBy: auth.userId,
    source: 'os_share',
  })

  const reportId = result.sessions[0]?.reportId
  if (!reportId) return { error: 'Rien n’a pu être importé' }

  // Le sas a fait son travail. Ce qui compte vit maintenant dans la visite.
  await clearStaged(auth.userId, lotId).catch(() => {})

  revalidatePath('/m')
  revalidatePath(`/m/visite/${reportId}`)
  revalidatePath(`/sites/${siteId}`)

  return { ok: true, reportId, count: result.created }
}

/** « Finalement, non. » Le sas se vide, rien n'a jamais existé. */
export async function discardShareAction(lotId: string): Promise<void> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) return
  if (!z.string().uuid().safeParse(lotId).success) return
  await clearStaged(auth.userId, lotId).catch(() => {})
}
