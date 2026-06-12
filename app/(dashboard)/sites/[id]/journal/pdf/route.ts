// Route GET /sites/[id]/journal/pdf
// Génère le PDF "Journal du chantier" à la volée.
//
// Auth : admin/manager uniquement.
// Données : getSiteIdentity + getSiteJournal (même source que la page HTML).
// Rendu : @react-pdf/renderer on-demand, pas de storage.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteJournal } from '@/lib/db/site-journal'
import { SiteJournalPdf } from '@/lib/pdf/site-journal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const [identity, entries] = await Promise.all([
    getSiteIdentity(id),
    getSiteJournal(id),
  ])

  if (!identity) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Noumea',
  })

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      SiteJournalPdf({
        siteName: identity.name,
        clientName: identity.clientName ?? null,
        address: (identity as { address?: string | null }).address ?? null,
        entries,
        exportDate,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[journal-pdf] PDF render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  const slug = identity.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="journal-${slug}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
