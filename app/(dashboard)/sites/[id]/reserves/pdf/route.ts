// GET /sites/[id]/reserves/pdf — export PDF des points à lever / réserves.
// Auth admin/manager. Rend le mini-dossier : statut, dates, photos avant/après,
// actions correctives, documents associés. À la volée, pas de storage.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { tenantCtx, tenantOwns } from '@/lib/db/tenant'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { listSiteActionsByReserve } from '@/lib/db/site-actions'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { getSignedPhotoUrl } from '@/lib/storage/intervention-photos'
import { ReservesPdf, type ReservePdfItem } from '@/lib/pdf/reserves'
import type { DbDocument, DbSiteAction } from '@/types/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ACTION_STATUS_FR: Record<DbSiteAction['status'], string> = {
  open: 'à faire', planned: 'planifiée', done: 'faite', cancelled: 'annulée',
}

function fmtDay(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Pacific/Noumea' })
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  // P1 isolation : les réserves d'un chantier d'un autre tenant n'existent pas
  // pour ce manager. Admin = super-admin plateforme.
  if (user.role !== 'admin') {
    const tctx = await tenantCtx()
    if (!tctx || !(await tenantOwns(tctx, 'sites', id))) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }
  }
  const [identity, reserves] = await Promise.all([getSiteIdentity(id), getSiteReserves(id)])
  if (!identity) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

  // Mini-dossier par réserve : photos signées + actions + documents (en parallèle).
  const items: ReservePdfItem[] = await Promise.all(
    reserves.map(async (r, i): Promise<ReservePdfItem> => {
      const [beforeUrl, afterUrl, actions, docs] = await Promise.all([
        r.photoBeforePath ? getSignedPhotoUrl(r.photoBeforePath) : Promise.resolve(null),
        r.photoAfterPath ? getSignedPhotoUrl(r.photoAfterPath) : Promise.resolve(null),
        listSiteActionsByReserve(r.id).catch(() => [] as DbSiteAction[]),
        listDocumentsForTarget('reserve', r.id).catch(() => [] as DbDocument[]),
      ])
      return {
        index: i + 1,
        label: r.label,
        status: r.status,
        location: r.location,
        issuedBy: r.issuedBy,
        issuedOn: fmtDay(r.issuedOn),
        liftedAt: fmtDay(r.liftedAt),
        liftNote: r.liftNote,
        photoBeforeUrl: beforeUrl,
        photoAfterUrl: afterUrl,
        actions: actions.map((a) => ({
          title: a.title, assignedTo: a.assigned_to, status: ACTION_STATUS_FR[a.status] ?? a.status, dueDate: a.due_date,
        })),
        documents: docs.map((d) => ({ filename: d.filename })),
      }
    }),
  )

  const dateLabel = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea' })

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      ReservesPdf({ siteName: identity.name, clientName: identity.clientName ?? null, dateLabel, reserves: items }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[reserves-pdf] render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="points-a-lever.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
