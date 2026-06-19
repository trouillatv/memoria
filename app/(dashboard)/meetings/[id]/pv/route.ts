// GET /meetings/[id]/pv — PDF du CR/PV de chantier généré, à la volée.
// Auth admin/manager. Rend depuis report_documents.sections (source de vérité).

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getLatestReportDocument } from '@/lib/db/report-documents'
import { getReportTemplate, companyLabelForOrg } from '@/lib/documents/templates/cr-chantier'
import { createAdminClient } from '@/lib/supabase/admin'
import { CrChantierPdf } from '@/lib/pdf/cr-chantier'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const [report, doc] = await Promise.all([getSiteReport(id), getLatestReportDocument(id)])
  if (!report) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })
  if (!doc) return NextResponse.json({ error: 'Aucun PV généré' }, { status: 404 })

  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const title = report.title || `Compte-rendu — ${identity?.name ?? 'chantier'}`
  const dateLabel = new Date(report.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea',
  })

  const tpl = getReportTemplate(doc.template_key)
  const orgAdmin = createAdminClient()
  const { data: orgRow } = doc.organization_id
    ? await orgAdmin.from('organizations').select('name, slug').eq('id', doc.organization_id).maybeSingle()
    : { data: null }
  const companyLabel = companyLabelForOrg(orgRow as { slug?: string | null; name?: string | null } | null)

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      CrChantierPdf({
        title,
        siteName: identity?.name ?? null,
        clientName: identity?.clientName ?? null,
        dateLabel,
        sections: doc.sections,
        layout: tpl?.layout ?? 'neutral',
        companyLabel,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[pv-pdf] render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="cr-chantier.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
