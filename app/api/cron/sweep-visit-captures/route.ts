// Cron « filet de sécurité » des captures de visite coincées (mig 166).
//
// Le chemin RAPIDE = la route worker déclenchée juste après l'upload. CE cron est
// le BACKSTOP : si le client s'est fermé avant de déclencher (réseau coupé,
// navigateur tué), ou si la route a échoué, la capture reste en stage non terminal.
// Ce balayage la reprend, indépendamment de tout polling client. Même pattern que
// sweep-stuck-tenders. Auth : Bearer CRON_SECRET. Fréquence : 1×/jour (plan Hobby).
//
// Seuil large (15 min) pour ne JAMAIS reprendre une capture encore légitimement en
// cours de traitement dans une requête.

import { NextResponse } from 'next/server'
import { sweepStuckCaptures } from '@/lib/visits/capture-pipeline'

export const runtime = 'nodejs'
export const maxDuration = 300

const STUCK_THRESHOLD_MS = 15 * 60 * 1000 // 15 min

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepStuckCaptures(STUCK_THRESHOLD_MS)
    if (result.swept) {
      console.warn(JSON.stringify({
        service: 'sweep-visit-captures',
        ...result,
        ts: new Date().toISOString(),
      }))
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sweep-visit-captures] failed:', e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
