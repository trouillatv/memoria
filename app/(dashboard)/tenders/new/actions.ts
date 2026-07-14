'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import {
  createTender,
  createTenderDocument,
  updateTenderStatus,
  countAnalysesToday,
  attachTenderToDossier,
} from '@/lib/db/tenders'
import { detectPieceKind } from '@/lib/tenders/pieces'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB
/** Un dossier d'AO tient en une dizaine de pièces ; au-delà, c'est une erreur de dépôt. */
const MAX_PIECES = 12

const createSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Affaire (dossier) pré-remplie quand on crée l'AO DEPUIS une affaire.
  dossier_id: z.string().uuid().nullable().optional(),
})

export async function createTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  // Un AO n'est pas un document : c'est un dossier de pièces (RC, CCAP, CCTP,
  // DPGF, BPU, plans). On accepte donc N fichiers — un seul reste valide.
  const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { error: 'Aucune pièce jointe' }
  if (files.length > MAX_PIECES) return { error: `Trop de pièces (${files.length}, maximum ${MAX_PIECES})` }
  for (const f of files) {
    if (f.type !== 'application/pdf') return { error: `Format PDF requis : ${f.name}` }
    if (f.size > MAX_PDF_BYTES) return { error: `Pièce trop lourde (> 20 Mo) : ${f.name}` }
  }

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    client_name: formData.get('client_name') || null,
    deadline: formData.get('deadline') || null,
    dossier_id: formData.get('dossier_id') || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Quota check
  const todayCount = await countAnalysesToday()
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) {
    return { error: `Quota journalier atteint (${todayCount}/${limit}). Réessayer demain ou augmenter MAX_AO_ANALYSES_PER_DAY.` }
  }

  // 1. Create tender row (status=draft)
  const tenderId = await createTender({
    title: parsed.data.title,
    client_name: parsed.data.client_name,
    deadline: parsed.data.deadline,
    created_by: userId,
  })

  // Rattachement auto à l'affaire si l'AO est créé depuis une affaire (best-effort).
  if (parsed.data.dossier_id) {
    await attachTenderToDossier(tenderId, parsed.data.dossier_id).catch(() => {})
  }

  // 2-3. Déposer CHAQUE pièce et créer sa ligne. Le PDF est stocké ; le TEXTE
  //      n'est PAS extrait ici — l'extraction synchrone (pdf-parse) bloquait le
  //      formulaire à l'infini. Elle a lieu dans la route /analyze, pièce par pièce.
  //
  //      La nature de la pièce est DÉDUITE du nom de fichier (déterministe, zéro
  //      IA). Elle peut être nulle : « pièce non qualifiée » est une réponse
  //      honnête, l'utilisateur corrigera.
  const supabase = createAdminClient()
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const storagePath = `${tenderId}/${Date.now()}-${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from('tender-documents')
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })
    if (uploadErr) {
      await updateTenderStatus(tenderId, 'failed', uploadErr.message)
      return { error: `Dépôt échoué (${file.name}) : ${uploadErr.message}` }
    }

    await createTenderDocument({
      tender_id: tenderId,
      storage_path: storagePath,
      filename: file.name,
      size_bytes: file.size,
      page_count: 0,
      extracted_text: null,
      kind: detectPieceKind(file.name),
    })
  }

  // 4. Statut 'extracting' → le loader de la page AO déclenche POST /analyze, qui
  //    fait extraction + analyse dans une vraie requête HTTP (fiable sur Vercel).
  await updateTenderStatus(tenderId, 'extracting')

  await logAuditEvent({
    userId, entityType: 'tender', entityId: tenderId,
    action: 'created',
    metadata: {
      title: parsed.data.title,
      pieces: files.length,
      size_bytes: files.reduce((sum, f) => sum + f.size, 0),
    },
  })
  revalidatePath('/tenders')

  // Le formulaire rend la main IMMÉDIATEMENT (plus aucune extraction synchrone).
  redirect(`/tenders/${tenderId}`)
}
