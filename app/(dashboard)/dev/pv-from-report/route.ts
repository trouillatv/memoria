// GET /dev/pv-from-report — génère un PV BECIB (.docx) depuis une VRAIE réunion.
// Admin/manager. Outil de test du Sprint A (vrai site_report → PV).
//   ?id=<reportId>        → télécharge le DOCX
//   ?id=<reportId>&info=1 → JSON { chantier, numeroCR, readiness (score/checks/gaps) }
//   (sans id)             → liste des réunions récentes pour en choisir une
// NB local : la conversion PDF se fait via LibreOffice ; en prod via Gotenberg.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadMeetingInput } from '@/lib/documents/load-meeting-input'
import { mapMeetingToCrBecib, pvReadiness } from '@/lib/documents/meeting-to-cr-becib'
import { buildPvDocx } from '@/lib/documents/pv-docx-template'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  // Outil de DEV : en local on ne bloque pas sur l'auth (les loaders utilisent
  // le service-role admin, indépendant de la session). En prod, admin/manager.
  if (process.env.NODE_ENV === 'production') {
    const user = await getCurrentUserWithProfile()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    const { data } = await createAdminClient()
      .from('site_reports').select('id, title, created_at, site_id')
      .order('created_at', { ascending: false }).limit(15)
    return NextResponse.json({ usage: '/dev/pv-from-report?id=<reportId>[&info=1]', recents: data ?? [] })
  }

  const input = await loadMeetingInput(id)
  if (!input) return NextResponse.json({ error: 'Réunion introuvable' }, { status: 404 })

  if (req.nextUrl.searchParams.get('info')) {
    const cr = mapMeetingToCrBecib(input)
    return NextResponse.json({ chantier: cr.meta.chantier, moa: cr.meta.moa, numeroCR: cr.meta.numeroCR, readiness: pvReadiness(input) })
  }

  try {
    const docx = buildPvDocx(mapMeetingToCrBecib(input))
    return new NextResponse(new Uint8Array(docx), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `inline; filename="pv-${id.slice(0, 8)}.docx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[dev/pv-from-report] failed:', e)
    return NextResponse.json({ error: `Génération échouée : ${msg}` }, { status: 500 })
  }
}
