import { NextResponse } from 'next/server'

// Durée max : mupdf + Supabase uploads + Gemini LLM dépassent facilement 30 s.
export const maxDuration = 300

/**
 * POST /api/extraction/engagement
 *
 * Auth :
 *   - utilisateur manager/admin (cookies) — appelé depuis le client (page document)
 *   - secret interne CRON_SECRET (x-internal-trigger) — appelé depuis after() dans les server actions
 *
 * Body : { documentId: string, force?: boolean }
 *
 * Contrairement à /api/extraction/historical-pv, cette route attend la fin de
 * extractEngagementCandidates (lib/documents/extract-engagement-candidates.ts)
 * avant de répondre : cet orchestrateur passe déjà le run en 'processing' très
 * tôt (avant le téléchargement/OCR/LLM), donc l'état "Analyse en cours" reste
 * observable par un rechargement concurrent de la page document sans qu'il
 * soit nécessaire de dupliquer la mécanique after()/polling de l'extracteur
 * historique — P0-2D n'est qu'un raccord, pas un refactor de l'extracteur P0-2B.
 */
export async function POST(req: Request) {
  let documentId = ''
  let userId: string | null = null

  try {
    const body = await req.json()
    documentId = body.documentId ?? ''
    const force = body.force === true

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
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId manquant' }, { status: 400 })
    }

    const { extractEngagementCandidates } = await import('@/lib/documents/extract-engagement-candidates')
    const result = await extractEngagementCandidates(documentId, userId, { force })

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, runId: result.runId }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e != null && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))
    console.error('[POST /api/extraction/engagement]:', { documentId, error: e })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
