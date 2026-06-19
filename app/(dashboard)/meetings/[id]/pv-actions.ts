'use server'

import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { resolveReportTemplate } from '@/lib/documents/templates/cr-chantier'
import { generatePv } from '@/services/ai/document-generation'
import {
  createReportDocument,
  getReportDocument,
  updateReportDocumentSections,
  validateReportDocument,
} from '@/lib/db/report-documents'
import {
  listDocumentCollections,
  createDocumentCollection,
  createDocument,
  addDocumentLink,
} from '@/lib/db/documents'
import { createAdminClient } from '@/lib/supabase/admin'
import { CrChantierPdf } from '@/lib/pdf/cr-chantier'
import type { ReportDocumentSection } from '@/types/db'

const CR_COLLECTION_NAME = 'Comptes-rendus de chantier'

async function requireManagerOrAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Not authenticated')
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Forbidden')
  return user
}

function meetingDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea',
  })
}

/** Génère un brouillon de PV à partir de la réunion déjà analysée. */
export async function generatePvAction(reportId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireManagerOrAdmin()
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable' }

  const transcript = report.transcript_corrected || report.transcript_raw || report.text_input || ''
  if (transcript.trim().length === 0) {
    return { ok: false, error: 'Aucune transcription/note exploitable pour générer le PV.' }
  }

  const actions = await listSiteActionsByReport(reportId)
  const template = resolveReportTemplate()

  try {
    const result = await generatePv({
      template,
      transcript,
      notes: report.text_input,
      participants: report.participants ?? [],
      risks: report.risks ?? [],
      actions,
      meetingTitle: report.title,
      meetingDateLabel: meetingDateLabel(report.created_at),
      userId: user.id,
    })

    const id = await createReportDocument({
      report_id: reportId,
      site_id: report.site_id,
      template_key: template.key,
      sections: result.sections,
      provider: result.provider,
      model: result.model,
      prompt_version: result.promptVersion,
      created_by: user.id,
    })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true, id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[generatePvAction] failed:', e)
    return { ok: false, error: `Génération échouée : ${msg}` }
  }
}

/** Sauvegarde l'édition humaine des sections (brouillon uniquement). */
export async function savePvSectionsAction(
  reportId: string,
  id: string,
  sections: ReportDocumentSection[],
): Promise<{ ok: boolean; error?: string }> {
  await requireManagerOrAdmin()
  try {
    await updateReportDocumentSections(id, sections)
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

async function getOrCreateCrCollection(): Promise<string> {
  const cols = await listDocumentCollections()
  const existing = cols.find((c) => c.name === CR_COLLECTION_NAME)
  if (existing) return existing.id
  return createDocumentCollection({ name: CR_COLLECTION_NAME })
}

/**
 * Fige le PV : rend le PDF, l'archive dans /documents (mémoire interrogeable,
 * cf. S5) et relie le document au site. Doctrine : le PV validé devient un
 * document de mémoire, plus un brouillon.
 */
export async function validatePvAction(
  reportId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireManagerOrAdmin()
  const doc = await getReportDocument(id)
  if (!doc) return { ok: false, error: 'PV introuvable' }
  const report = await getSiteReport(reportId)
  if (!report) return { ok: false, error: 'Réunion introuvable' }

  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const title = report.title || `Compte-rendu — ${identity?.name ?? 'chantier'}`

  try {
    const pdfBuffer = await renderToBuffer(
      CrChantierPdf({
        title,
        siteName: identity?.name ?? null,
        clientName: identity?.clientName ?? null,
        dateLabel: meetingDateLabel(report.created_at),
        sections: doc.sections,
      }),
    )

    const supabase = createAdminClient()
    const storagePath = `pv/${id}/cr-chantier-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, new Uint8Array(pdfBuffer), { contentType: 'application/pdf', upsert: false })
    if (upErr) return { ok: false, error: `Upload PDF échoué : ${upErr.message}` }

    const collectionId = await getOrCreateCrCollection()
    const filename = `${title}.pdf`.replace(/[/\\]/g, '-')
    const documentId = await createDocument({
      collection_id: collectionId,
      document_type: 'autre', // pas de type « compte_rendu » dans l'enum — à étendre plus tard
      storage_path: storagePath,
      filename,
      visibility_level: 'manager',
      size_bytes: pdfBuffer.length,
      analysis_status: 'pending', // sera indexé par le pipeline async → cherchable (S5)
      created_by: user.id,
    })

    if (report.site_id) {
      try {
        await addDocumentLink(documentId, 'site', report.site_id)
      } catch (e) {
        console.error('[validatePvAction] addDocumentLink failed:', e)
      }
    }

    await validateReportDocument(id, { document_id: documentId, pdf_path: storagePath })
    revalidatePath(`/meetings/${reportId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[validatePvAction] failed:', e)
    return { ok: false, error: msg }
  }
}
