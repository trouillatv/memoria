// /meetings/[id]/pv/final — VERSION FINALE DIFFUSÉE du CR (Niveau 1, Vincent 2026-06-20).
//   POST  → téléverse le DOCX/PDF final corrigé à la main → stocke + lie au site +
//           trace la version finale sur la réunion. N'écrase PAS la mémoire.
//   GET   → télécharge la dernière version finale diffusée.
// La version finale = vérité juridique (ce qui a réellement été envoyé). La
// comparaison des écarts + l'apprentissage = Niveau 2/3 (plus tard).
import { NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { createAdminClient } from '@/lib/supabase/admin'
import { createDocument, addDocumentLink, listDocumentCollections, createDocumentCollection } from '@/lib/db/documents'
import { getLatestReportDocument, setReportDocumentFinal } from '@/lib/db/report-documents'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CR_COLLECTION_NAME = 'Comptes-rendus de chantier'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function getOrCreateCrCollection(): Promise<string> {
  const cols = await listDocumentCollections()
  const existing = cols.find((c) => c.name === CR_COLLECTION_NAME)
  return existing ? existing.id : createDocumentCollection({ name: CR_COLLECTION_NAME })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const report = await getSiteReport(id)
  if (!report) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 })
  const lower = (file.name || '').toLowerCase()
  const ext = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : null
  if (!ext) return NextResponse.json({ error: 'Format attendu : PDF ou DOCX.' }, { status: 400 })

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const supabase = createAdminClient()
    const storagePath = `pv/${id}/final-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: ext === 'pdf' ? 'application/pdf' : DOCX_MIME, upsert: false })
    if (upErr) return NextResponse.json({ error: `Upload échoué : ${upErr.message}` }, { status: 500 })

    const collectionId = await getOrCreateCrCollection()
    const title = report.title || 'Compte-rendu'
    const documentId = await createDocument({
      collection_id: collectionId,
      document_type: 'autre',
      storage_path: storagePath,
      filename: `${title} (version finale).${ext}`.replace(/[/\\]/g, '-'),
      visibility_level: 'manager',
      size_bytes: bytes.length,
      analysis_status: 'pending', // indexé async → la version finale devient cherchable
      created_by: user.id,
    })
    if (report.site_id) {
      try { await addDocumentLink(documentId, 'site', report.site_id) } catch (e) { console.error('[pv/final] link failed:', e) }
    }
    await setReportDocumentFinal({ report_id: id, site_id: report.site_id, final_document_id: documentId, final_path: storagePath, finalized_by: user.id })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[pv/final] POST failed:', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production') {
    const user = await getCurrentUserWithProfile()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await ctx.params
  const doc = await getLatestReportDocument(id)
  if (!doc?.final_path) return NextResponse.json({ error: 'Aucune version finale diffusée.' }, { status: 404 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from('documents').download(doc.final_path)
  if (error || !data) return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  const buf = Buffer.from(await data.arrayBuffer())
  const ext = doc.final_path.endsWith('.pdf') ? 'pdf' : 'docx'
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': ext === 'pdf' ? 'application/pdf' : DOCX_MIME,
      'Content-Disposition': `inline; filename="CR-final-${id.slice(0, 8)}.${ext}"`,
      'Cache-Control': 'no-store',
    },
  })
}
