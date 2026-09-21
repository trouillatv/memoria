// GET /meetings/[id]/pv — CR de chantier « Template Chantier v1 » (la vraie trame
// haute-fidélité, historiquement issue de BECIB : intervenants, points examinés,
// avancement, PLANNING, SÉCURITÉ, photos, cartouche). Rendu À LA VOLÉE depuis les
// DONNÉES de la réunion (déterministe, cohérent avec « la mémoire d'abord »).
//
// IDENTITÉ = celle de l'organisation : le nom de l'org au bandeau ; le logo BECIB
// est réservé à l'org BECIB (les autres portent leur nom). Trame partagée, identité
// propre (directive Vincent 2026-06-20).
//
//   défaut          → PDF propre (sortie officielle)
//   ?format=docx    → DOCX éditable (option secondaire ; alias historique ?becib=1)
import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { renderToStream } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { loadMeetingInput } from '@/lib/documents/load-meeting-input'
import { mapMeetingToCrBecib } from '@/lib/documents/meeting-to-cr-becib'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import { buildPvDocx } from '@/lib/documents/pv-docx-template'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // En prod : admin/manager. En local (dev) : on ne bloque pas (les loaders
  // utilisent le service-role admin, indépendant de la session).
  if (process.env.NODE_ENV === 'production') {
    const user = await getCurrentUserWithProfile()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'manager') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { id } = await ctx.params
  const input = await loadMeetingInput(id, { embedPhotos: true }) // photos base64 dans le rendu
  if (!input) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  const cr = mapMeetingToCrBecib(input) // identité de l'org portée par cr.meta.moe
  const params = new URL(req.url).searchParams
  const wantDocx = params.get('format') === 'docx' || params.get('becib') // alias historique

  try {
    if (wantDocx) {
      const docx = buildPvDocx(cr)
      return new NextResponse(new Uint8Array(docx), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `inline; filename="CR-Chantier-${id.slice(0, 8)}.docx"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    // Un PV embarque des photos réelles (embedPhotos: true) et peut dépasser la
    // limite dure de 4,5 Mo qu'impose Vercel au corps d'une réponse de fonction
    // BUFFERISÉE — même panne que le CR de visite La Foa (13,19 Mo). renderToStream
    // évite ce plafond en laissant Vercel transmettre les octets au fur et à
    // mesure de leur production (Vincent, 2026-09-21).
    const nodeStream = await renderToStream(CrBecibPdf({ cr }))
    nodeStream.on('error', (e) => console.error('[pv] PDF stream error:', e))
    const webStream = Readable.toWeb(nodeStream as Readable) as unknown as ReadableStream
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="CR-Chantier-${id.slice(0, 8)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[pv] render failed:', e)
    return NextResponse.json({ error: `Erreur génération CR : ${msg}` }, { status: 500 })
  }
}
