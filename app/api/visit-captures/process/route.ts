// Route worker des captures de visite (mig 166).
//
// Le travail d'enrichissement (aujourd'hui : transcription d'un vocal) tourne
// DANS cette requête HTTP — fiable sur Vercel, contrairement à after() qui est
// coupé (cf. pattern AO, [[visite-trois-temps]]). Le CLIENT ne fait que la
// DÉCLENCHER juste après l'upload ; il n'est jamais responsable du traitement.
// Si le client se ferme avant ou pendant, la capture reste en stage non terminal
// et le cron quotidien (/api/cron/sweep-visit-captures) la rattrape.
//
// Auth : agent terrain (cookies). Pas de secret interne nécessaire — le cron
// appelle la lib directement, pas cette route.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { runCapturePipeline } from '@/lib/visits/capture-pipeline'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({ captureId: z.string().uuid() })

export async function POST(req: Request) {
  const auth = await requireFieldAgent()
  if ('error' in auth) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

  let captureId: string
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Paramètres invalides' }, { status: 400 })
    captureId = parsed.data.captureId
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 400 })
  }

  const result = await runCapturePipeline(captureId)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
