// Cron « filet de sécurité ultime » contre les AO coincés.
//
// Contexte : l'analyse d'un AO tourne dans un after() (cf. tenders/new/actions),
// qui dépend de Vercel + réseau + Gemini + DB. Beaucoup de points de
// défaillance. La status route auto-fail à 4 min, MAIS seulement si un client
// poll. Si personne n'a la page ouverte (onglet fermé, after() tué net, DB
// injoignable au moment de marquer `failed`), l'AO reste `analyzing` pour
// toujours. Ce cron rattrape ces cas, indépendamment de tout polling.
//
// Déclenché par Vercel Cron (cf. vercel.json). Auth : Bearer CRON_SECRET
// (même pattern que backup / refresh-memory-readings).
//
// Fréquence : 1×/jour (plan Vercel gratuit/Hobby = max 1 cron quotidien). Le
// filet RAPIDE reste la status route (auto-fail 4 min dès qu'un client poll) ;
// ce cron est le backstop pour les AO coincés quand PERSONNE ne poll (onglet
// fermé, after() tué, DB injoignable au moment de marquer `failed`).
//
// Seuil : 10 min — volontairement plus large que la status route (4 min) pour
// ne JAMAIS basculer un AO encore légitimement en cours d'analyse.

import { NextResponse } from 'next/server'
import { failStuckTenders } from '@/lib/db/tenders'

export const runtime = 'nodejs'
export const maxDuration = 60

const STUCK_THRESHOLD_MS = 10 * 60 * 1000 // 10 min

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const failedIds = await failStuckTenders(STUCK_THRESHOLD_MS)
    if (failedIds.length) {
      console.warn(JSON.stringify({
        service: 'sweep-stuck-tenders',
        swept: failedIds.length,
        ids: failedIds,
        ts: new Date().toISOString(),
      }))
    }
    return NextResponse.json({ ok: true, swept: failedIds.length, ids: failedIds })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sweep-stuck-tenders] failed:', e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
