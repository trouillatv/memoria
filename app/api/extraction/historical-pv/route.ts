import { NextResponse } from 'next/server'

// Durée max : l'extraction tourne DANS cette requête, pas en after().
// mupdf + Supabase uploads + Gemini LLM peuvent dépasser 30 s facilement.
export const maxDuration = 300

/**
 * Déclenche l'extraction d'un PV historique dans une fonction dédiée.
 * Auth : secret interne uniquement (x-internal-trigger).
 * Appelé en fire-and-forget depuis les server actions via after().
 */
export async function POST(req: Request) {
  let documentId = ''
  try {
    const internal = process.env.INTERNAL_ANALYZE_SECRET
    const trigger = req.headers.get('x-internal-trigger')
    if (!internal || trigger !== internal) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    documentId = body.documentId ?? ''
    const userId: string | null = body.userId ?? null
    const siteId: string | null = body.siteId ?? null

    if (!documentId) {
      return NextResponse.json({ ok: false, error: 'documentId manquant' }, { status: 400 })
    }

    const { extractHistoricalPv } = await import('@/lib/documents/extract-historical-pv')
    await extractHistoricalPv(documentId, userId, siteId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[POST /api/extraction/historical-pv] unhandled:', { documentId, error: e })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
