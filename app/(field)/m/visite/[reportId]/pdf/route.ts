// Route GET /m/visite/[reportId]/pdf
// Génère à la volée le PDF « Compte-rendu de visite » — sortie partageable du
// Débrief, depuis le terrain. Projection déterministe du VisitCrDoc (zéro IA,
// zéro stockage).
//
// Auth : rôles terrain (chef_equipe / admin / manager) + scope organisation.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { VisitCrPdf } from '@/lib/pdf/visit-cr'
import { loadCrMapSnapshotDataUri } from '@/lib/pdf/cr-map-snapshot'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteCtx {
  params: Promise<{ reportId: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'chef_equipe' && user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { reportId } = await ctx.params
  const visit = await getVisit(reportId)
  if (!visit) return NextResponse.json({ error: 'Visite introuvable' }, { status: 404 })
  // Scope org : une visite d'une autre organisation n'existe pas pour cet agent.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const doc = await buildVisitCrDoc(reportId, user.id)
  if (!doc) return NextResponse.json({ error: 'Visite introuvable' }, { status: 404 })

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Noumea',
  })

  // Le PDF CONSOMME l'instantané carte déjà produit — il ne le fabrique jamais
  // (aucune requête réseau ici). Absent → VisitCrPdf retombe sur le schéma métrique.
  const mapImage = doc.positions.length > 0
    ? await loadCrMapSnapshotDataUri(reportId).catch(() => null)
    : null

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(VisitCrPdf({ doc, exportDate, mapImage }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[visit-cr-pdf] PDF render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  const slug = doc.siteName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  // ?download=1 → attachment : le mobile TÉLÉCHARGE le fichier (bouton « Télécharger »).
  // Sinon inline : le mobile OUVRE le PDF (aperçu), l'agent peut ensuite partager.
  const download = new URL(req.url).searchParams.has('download')
  const disposition = download ? 'attachment' : 'inline'

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="cr-visite-${slug || 'chantier'}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
