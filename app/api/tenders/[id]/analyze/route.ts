import { NextResponse } from 'next/server'
import { getTender, updateTenderStatus } from '@/lib/db/tenders'
import { getUserRoleById } from '@/lib/db/users'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { runTenderAnalysis } from '@/lib/tenders/run-analysis'

// Durée max de la fonction (l'analyse tourne DANS cette requête, pas en after()).
export const maxDuration = 300

/**
 * Exécute l'analyse d'un AO DANS la requête HTTP (fiable sur Vercel, contrairement
 * à after() qui est coupé). Déclenchée par le client (loader) sur la page de l'AO.
 *
 * Auth : utilisateur manager/admin (cookies) OU secret interne (x-internal-trigger).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    let userId: string | null = null
    const internal = process.env.INTERNAL_ANALYZE_SECRET
    const trigger = req.headers.get('x-internal-trigger')

    if (internal && trigger === internal) {
      const tender = await getTender(id)
      userId = tender?.created_by ?? null
    } else {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 })
      const role = await getUserRoleById(user.id)
      if (role !== 'manager' && role !== 'admin') {
        return NextResponse.json({ ok: false, error: 'Accès refusé' }, { status: 403 })
      }
      userId = user.id
    }

    const result = await runTenderAnalysis(id, userId)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (e) {
    // Aucune erreur ne doit rester invisible : on renvoie TOUJOURS du JSON lisible.
    const msg = e instanceof Error ? `${e.message}` : String(e)
    console.error('[POST /analyze] unhandled:', e)
    try { await updateTenderStatus(id, 'failed', `route: ${msg}`) } catch { /* best-effort */ }
    return NextResponse.json({ ok: false, error: `route: ${msg}` }, { status: 500 })
  }
}
