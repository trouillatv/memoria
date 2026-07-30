import { NextResponse } from 'next/server'

// Durée max : mupdf + Supabase uploads + Gemini LLM dépassent facilement 30 s.
export const maxDuration = 300

/**
 * POST /api/extraction/historical-pv
 *
 * Auth :
 *   - utilisateur manager/admin (cookies) — appelé depuis le client (page document)
 *   - secret interne CRON_SECRET (x-internal-trigger) — appelé depuis after() dans les server actions
 *
 * Body : { documentId: string, siteId?: string | null }
 * (userId ignoré côté client — déduit du cookie)
 */
export async function POST(req: Request) {
  let documentId = ''
  let userId: string | null = null
  let siteId: string | null = null

  try {
    const body = await req.json()
    documentId = body.documentId ?? ''
    siteId = body.siteId ?? null

    const secret = process.env.CRON_SECRET
    const trigger = req.headers.get('x-internal-trigger')

    if (secret && trigger === secret) {
      userId = body.userId ?? null
    } else {
      const { createClient: createServerClient } = await import('@/lib/supabase/server')
      const { getUserRoleById } = await import('@/lib/db/users')
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 })
      const role = await getUserRoleById(user.id)
      if (role !== 'manager' && role !== 'admin') {
        return NextResponse.json({ ok: false, error: 'Accès refusé' }, { status: 403 })
      }
      userId = user.id
    }

    if (!documentId) {
      return NextResponse.json({ ok: false, error: 'documentId manquant' }, { status: 400 })
    }

    // Garde : ne pas lancer deux extractions en parallèle sur le même document.
    const { getLatestExtractionRunForDocument } = await import('@/lib/db/document-extractions')
    const existing = await getLatestExtractionRunForDocument(documentId)
    if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
      return NextResponse.json({ ok: false, error: 'Analyse déjà en cours.', runId: existing.id }, { status: 409 })
    }

    const { extractHistoricalPv } = await import('@/lib/documents/extract-historical-pv')
    await extractHistoricalPv(documentId, userId, siteId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e != null && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))
    console.error('[POST /api/extraction/historical-pv]:', { documentId, error: e })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

/**
 * GET /api/extraction/historical-pv/status?runId=xxx
 *
 * Polling léger pour la barre de progression — auth cookie uniquement.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const runId = searchParams.get('runId')
  if (!runId) return NextResponse.json({ error: 'runId manquant' }, { status: 400 })

  try {
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { getExtractionRun } = await import('@/lib/db/document-extractions')
    const run = await getExtractionRun(runId)
    if (!run) return NextResponse.json({ error: 'Run introuvable' }, { status: 404 })

    return NextResponse.json({
      status: run.status,
      currentStage: run.current_stage ?? null,
      errorMessage: run.error_message ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e != null && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
