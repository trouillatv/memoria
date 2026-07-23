// /meetings/[id]/pv/final — VERSIONS de la version finale diffusée (Vincent 2026-06-20).
//   POST            → téléverse le DOCX/PDF final corrigé → EMPILE une version (v1, v2…)
//                     + note de diffusion optionnelle. N'écrase pas les versions ni la mémoire.
//   GET             → télécharge la DERNIÈRE version diffusée.
//   GET ?v=N        → télécharge la version N (preuve historique).
// Un document diffusé = vérité juridique : on conserve TOUT l'historique.
import { NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { createAdminClient } from '@/lib/supabase/admin'
import { createDocument, addDocumentLink, listDocumentCollections, createDocumentCollection } from '@/lib/db/documents'
import { addReportFinalVersion, listReportFinalVersions } from '@/lib/db/report-final-versions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CR_COLLECTION_NAME = 'Comptes-rendus de chantier'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function getOrCreateCrCollection(reportId: string): Promise<string> {
  const cols = await listDocumentCollections()
  const existing = cols.find((c) => c.name === CR_COLLECTION_NAME)
  return existing ? existing.id : createDocumentCollection({
    name: CR_COLLECTION_NAME,
    scope_type: 'report',
    scope_id: reportId,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const report = await getSiteReport(id)
  if (!report) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })
  // P1 isolation : un report d'un autre tenant n'existe pas pour ce manager
  // (ni lecture ni INJECTION de version). Admin = super-admin plateforme.
  if (user.role !== 'admin' && (!user.organization_id || report.organization_id !== user.organization_id)) {
    return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })
  }

  const form = await req.formData()
  const file = form.get('file')
  const note = (form.get('note') as string | null)?.trim() || null
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 })
  const lower = (file.name || '').toLowerCase()
  const format: 'pdf' | 'docx' | null = lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.docx') ? 'docx' : null
  if (!format) return NextResponse.json({ error: 'Format attendu : PDF ou DOCX.' }, { status: 400 })

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const supabase = createAdminClient()
    const storagePath = `pv/${id}/final-${Date.now()}.${format}`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: format === 'pdf' ? 'application/pdf' : DOCX_MIME, upsert: false })
    if (upErr) return NextResponse.json({ error: `Upload échoué : ${upErr.message}` }, { status: 500 })

    const collectionId = await getOrCreateCrCollection(id)
    const title = report.title || 'Compte-rendu'
    const documentId = await createDocument({
      collection_id: collectionId,
      document_type: 'autre',
      storage_path: storagePath,
      filename: `${title} (version finale).${format}`.replace(/[/\\]/g, '-'),
      visibility_level: 'manager',
      size_bytes: bytes.length,
      analysis_status: 'pending', // indexé async → la version finale devient cherchable
      created_by: user.id,
    })
    if (report.site_id) {
      try { await addDocumentLink(documentId, 'site', report.site_id) } catch (e) { console.error('[pv/final] link failed:', e) }
    }
    const { versionNo } = await addReportFinalVersion({
      reportId: id, siteId: report.site_id, documentId, path: storagePath, format, note, finalizedBy: user.id,
    })
    return NextResponse.json({ ok: true, versionNo })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[pv/final] POST failed:', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // P1 isolation : auth PARTOUT (le bypass hors-production laissait le
  // téléchargement 100 % public en preview) + garde d'appartenance org.
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const report = await getSiteReport(id)
  if (!report) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })
  if (user.role !== 'admin' && (!user.organization_id || report.organization_id !== user.organization_id)) {
    return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })
  }
  const versions = await listReportFinalVersions(id)
  if (versions.length === 0) return NextResponse.json({ error: 'Aucune version finale diffusée.' }, { status: 404 })

  const vParam = new URL(req.url).searchParams.get('v')
  const target = vParam ? versions.find((v) => String(v.versionNo) === vParam) : versions[versions.length - 1]
  if (!target) return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from('documents').download(target.path)
  if (error || !data) return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  const buf = Buffer.from(await data.arrayBuffer())
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': target.format === 'pdf' ? 'application/pdf' : DOCX_MIME,
      'Content-Disposition': `inline; filename="CR-final-${id.slice(0, 8)}-v${target.versionNo}.${target.format}"`,
      'Cache-Control': 'no-store',
    },
  })
}
