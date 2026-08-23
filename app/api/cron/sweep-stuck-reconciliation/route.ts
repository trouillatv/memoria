// Cron de reprise des réconciliations canoniques coincées.
//
// Invariant tenu : toute visite éligible finit soit canonicalisée, soit dans un
// état d'erreur observable et rejouable — jamais silencieusement entre les deux.
//
// Ce cron REJOUE, il n'alerte pas seulement. Alerter transformerait une panne
// silencieuse automatique en panne bruyante nécessitant un humain, alors que
// decideReconcileLock et l'idempotence permettent précisément la reprise.
//
// Pourquoi un second niveau alors que le chemin terrain passe désormais par
// after() : l'audit a mesuré la MÊME perte sur le chemin import, pourtant
// `await`-é. Une fonction tuée en cours ne passe ni par son catch, ni par son
// finally. Aucun mécanisme de premier niveau ne survit à un kill brutal.
//
// Auth : Bearer CRON_SECRET, même pattern que sweep-stuck-tenders.

import { NextResponse } from 'next/server'
import {
  findStuckReconciliations,
  replayReconciliation,
  getReconciliationHealth,
  type SweepOutcome,
} from '@/lib/db/reconciliation-sweep'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Une réconciliation légitime a été mesurée jusqu'à ~6 min — soit déjà plus que
 * `maxDuration`. Un seul rejeu par passage : deux suffiraient à faire tuer le
 * cron au milieu d'un run, exactement le mode de panne qu'il est censé fermer.
 *
 * Arbitrage Vincent : « je préfère 1 replay par cron si la cadence du cron est
 * suffisamment fréquente ». C'est la cadence (toutes les 6 h) qui porte le débit,
 * pas la taille du lot. Le reste est repris au passage suivant : la reprise est
 * idempotente, elle n'a pas besoin d'être exhaustive en une fois. Ce qui est
 * reporté est journalisé, jamais silencieux.
 */
const MAX_REPLAYS_PER_RUN = 1

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stuck = await findStuckReconciliations()
    const batch = stuck.slice(0, MAX_REPLAYS_PER_RUN)
    const deferred = stuck.length - batch.length

    const replayed: Array<{ reportId: string; outcome: SweepOutcome }> = []
    for (const item of batch) {
      let outcome: SweepOutcome
      try {
        outcome = await replayReconciliation(item)
      } catch (e) {
        // replayReconciliation persiste déjà l'erreur côté report ; ici on
        // protège seulement la suite de la boucle.
        console.error('[sweep-stuck-reconciliation] rejeu non rattrapé', item.reportId, ':', e)
        outcome = 'failed'
      }
      replayed.push({ reportId: item.reportId, outcome })
    }

    const health = await getReconciliationHealth()

    if (stuck.length > 0) {
      console.warn(
        JSON.stringify({
          service: 'sweep-stuck-reconciliation',
          found: stuck.length,
          replayed,
          deferred,
          health,
          ts: new Date().toISOString(),
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      found: stuck.length,
      replayed,
      deferred,
      health,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sweep-stuck-reconciliation] failed:', e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
