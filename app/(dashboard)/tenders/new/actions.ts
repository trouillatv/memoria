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
} from '@/lib/db/tenders'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB

// Timeouts : un AO lourd peut faire PENDRE l'extraction (pdf-parse) ou l'OCR
// sans jamais throw → le server action ne rend pas la main → le formulaire
// reste bloqué « Upload + analyse en cours… » à l'infini. On borne ces étapes :
// au-delà, l'AO bascule en `failed` avec un message exploitable (jamais un hang).
const EXTRACT_TIMEOUT_MS = 90_000
const OCR_TIMEOUT_MS = 120_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} : délai dépassé (${Math.round(ms / 1000)}s)`)), ms),
    ),
  ])
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  client_name: z.string().max(200).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function createTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'PDF manquant' }
  if (file.type !== 'application/pdf') return { error: 'Format PDF requis' }
  if (file.size > MAX_PDF_BYTES) return { error: 'PDF > 20 MB' }

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    client_name: formData.get('client_name') || null,
    deadline: formData.get('deadline') || null,
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

  // 2. Upload PDF to bucket
  const supabase = createAdminClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const storagePath = `${tenderId}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabase.storage
    .from('tender-documents')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) {
    await updateTenderStatus(tenderId, 'failed', uploadErr.message)
    return { error: `Upload échoué : ${uploadErr.message}` }
  }

  // 3. Update status to extracting
  await updateTenderStatus(tenderId, 'extracting')

  // 4. Extract text
  let extracted: { text: string; pageCount: number; isLikelyScanned: boolean }
  try {
    const r = await withTimeout(extractPdfText(buffer), EXTRACT_TIMEOUT_MS, 'Extraction PDF')
    extracted = r
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[createTenderAction] PDF extraction failed:', e)
    await updateTenderStatus(tenderId, 'failed', `extraction: ${msg}`)
    return { error: `Extraction texte échouée : ${msg}` }
  }

  let extractionSource: 'native' | 'ocr' = 'native'

  if (extracted.isLikelyScanned) {
    // Fallback OCR via Gemini Vision si clé disponible
    let ocrText: string | null = null
    if (process.env.GOOGLE_GENAI_API_KEY) {
      try {
        ocrText = await withTimeout(extractWithGeminiOCR(buffer), OCR_TIMEOUT_MS, 'OCR')
      } catch (e) {
        console.error(JSON.stringify({
          service: 'createTenderAction',
          source: 'gemini_ocr',
          tender_id: tenderId,
          error: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString(),
        }))
      }
    }

    if (ocrText) {
      extracted = { ...extracted, text: ocrText, isLikelyScanned: false }
      extractionSource = 'ocr'
      // Continues to step 5 with OCR text
    } else {
      await updateTenderStatus(tenderId, 'failed', 'scanned_pdf_unsupported')
      await createTenderDocument({
        tender_id: tenderId,
        storage_path: storagePath,
        filename: file.name,
        size_bytes: file.size,
        page_count: extracted.pageCount,
        extracted_text: '',
      })
      await logAuditEvent({
        userId, entityType: 'tender', entityId: tenderId,
        action: 'created',
        metadata: { title: parsed.data.title, page_count: extracted.pageCount, status: 'failed', reason: 'scanned_pdf_unsupported' },
      })
      redirect(`/tenders/${tenderId}`)
    }
  }

  // 5. Create tender_documents row with extracted text
  await createTenderDocument({
    tender_id: tenderId,
    storage_path: storagePath,
    filename: file.name,
    size_bytes: file.size,
    page_count: extracted.pageCount,
    extracted_text: extracted.text,
    extraction_source: extractionSource,
  })

  // 6. Set status to analyzing
  await updateTenderStatus(tenderId, 'analyzing')

  await logAuditEvent({
    userId, entityType: 'tender', entityId: tenderId,
    action: 'created',
    metadata: { title: parsed.data.title, page_count: extracted.pageCount, char_count: extracted.text.length },
  })
  revalidatePath('/tenders')

  // 7. L'analyse NE tourne PLUS en after() (coupé par Vercel → AO coincé). Le
  //    statut est 'analyzing' ; le client (loader sur la page de l'AO) déclenche
  //    l'analyse via POST /api/tenders/[id]/analyze, qui tourne dans une vraie
  //    requête HTTP (fiable). On redirige simplement vers la page de l'AO.
  redirect(`/tenders/${tenderId}`)
}
