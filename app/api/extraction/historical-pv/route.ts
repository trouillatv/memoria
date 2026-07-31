import { NextResponse, after } from 'next/server'

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
 *
 * Répond immédiatement avec { ok: true, runId } dès que le run est créé.
 * L'extraction tourne en arrière-plan via after() — le client poll le statut.
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

    const { getLatestExtractionRunForDocument, createExtractionRun } = await import('@/lib/db/document-extractions')

    // Garde : ne pas lancer deux extractions en parallèle sur le même document.
    const existing = await getLatestExtractionRunForDocument(documentId)
    if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
      return NextResponse.json({ ok: false, error: 'Analyse déjà en cours.', runId: existing.id }, { status: 409 })
    }

    // Charger le document pour obtenir organization_id et valider le type.
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { data: doc } = await admin
      .from('documents')
      .select('organization_id, document_type')
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!doc) return NextResponse.json({ ok: false, error: 'Document introuvable' }, { status: 404 })
    const d = doc as { organization_id: string; document_type: string }
    if (d.document_type !== 'historical_visit_report') {
      return NextResponse.json({ ok: false, error: 'Type de document invalide' }, { status: 400 })
    }

    // Résoudre le siteId depuis document_links si non fourni.
    let resolvedSiteId = siteId
    if (!resolvedSiteId) {
      const { data: link } = await admin
        .from('document_links')
        .select('target_id')
        .eq('document_id', documentId)
        .eq('target_type', 'site')
        .maybeSingle()
      resolvedSiteId = (link as { target_id: string } | null)?.target_id ?? null
    }

    // Créer le run immédiatement — on peut renvoyer le runId sans attendre l'extraction.
    const runId = await createExtractionRun({
      document_id: documentId,
      organization_id: d.organization_id,
      extractor_key: 'historical_visit_report_v1',
      extractor_version: '1.0.0',
      target_site_id: resolvedSiteId ?? undefined,
      created_by: userId ?? null,
    })

    // Extraction en arrière-plan : la connexion HTTP est libérée immédiatement,
    // Vercel ne peut pas couper la réponse en cours de traitement.
    after(async () => {
      const { extractHistoricalPv } = await import('@/lib/documents/extract-historical-pv')
      await extractHistoricalPv(documentId, userId, resolvedSiteId, runId)
    })

    // Le client reçoit le runId et commence à poller — pas besoin d'attendre la fin.
    return NextResponse.json({ ok: true, runId })
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
