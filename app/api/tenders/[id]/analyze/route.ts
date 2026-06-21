import { NextResponse } from 'next/server'

// Durée max de la fonction (l'analyse tourne DANS cette requête, pas en after()).
export const maxDuration = 300

/**
 * Exécute l'analyse d'un AO DANS la requête HTTP (fiable sur Vercel, contrairement
 * à after() qui est coupé). Déclenchée par le client (loader) sur la page de l'AO.
 *
 * Auth : utilisateur manager/admin (cookies) OU secret interne (x-internal-trigger).
 *
 * IMPORTANT : tous les imports « lourds » (run-analysis → pdf-parse, orchestrator,
 * supabase) sont chargés DYNAMIQUEMENT dans le try. Si un module échoue à se charger
 * au runtime Vercel, l'erreur est ATTRAPÉE et rapportée (JSON + error_msg) au lieu
 * d'un 500 muet (page d'erreur Next) qu'on ne peut pas diagnostiquer.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let id = ''
  try {
    id = (await ctx.params).id

    const { getTender } = await import('@/lib/db/tenders')
    const { getUserRoleById } = await import('@/lib/db/users')

    let userId: string | null = null
    const internal = process.env.INTERNAL_ANALYZE_SECRET
    const trigger = req.headers.get('x-internal-trigger')

    if (internal && trigger === internal) {
      const tender = await getTender(id)
      userId = tender?.created_by ?? null
    } else {
      const { createClient: createServerClient } = await import('@/lib/supabase/server')
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 })
      const role = await getUserRoleById(user.id)
      if (role !== 'manager' && role !== 'admin') {
        return NextResponse.json({ ok: false, error: 'Accès refusé' }, { status: 403 })
      }
      userId = user.id
    }

    const { runTenderAnalysis } = await import('@/lib/tenders/run-analysis')
    const result = await runTenderAnalysis(id, userId)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}` : String(e)
    console.error('[POST /analyze] unhandled:', e)
    if (id) {
      try {
        const { updateTenderStatus } = await import('@/lib/db/tenders')
        await updateTenderStatus(id, 'failed', `route: ${msg}`)
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ ok: false, error: `route: ${msg}` }, { status: 500 })
  }
}
