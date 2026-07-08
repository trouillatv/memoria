// LA NUIT DE MEMORIA — cron du métabolisme nocturne (Vincent 2026-07-08).
// Déclenchement : 06h00 Nouméa = 19h00 UTC (vercel.json) — le digest est prêt
// AVANT la journée de travail, pour la date civile Nouméa du matin servi.
//
// Ce que fait cette tâche :
//   1. Liste les chantiers actifs (deleted_at null, phase 'actif'), toutes orgs.
//   2. Rejoue les détecteurs mémoire déterministes (buildSiteMemorySignals)
//      sur chacun — séquentiel, best-effort, un échec n'arrête rien.
//   3. Persiste le digest par chantier (site_morning_digest, upsert) — y
//      compris VIDE : « rien à signaler » ≠ « pas calculé ».
//   4. Purge les digests > 30 jours.
//
// Ce qu'elle ne fait PAS :
//   - Appeler un LLM (zéro IA, zéro coût — détecteurs 100 % déterministes).
//   - Notifier qui que ce soit : UNE apparition, le matin, sur le dashboard.
//   - Recalculer sans borne (cap MAX_SITES_PER_RUN).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { writeSiteMorningDigest, purgeOldDigests } from '@/lib/db/morning-digest'
import { todayLocalIso } from '@/lib/time/local-date'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_SITES_PER_RUN = 50
const RETENTION_DAYS = 30

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const digestDate = todayLocalIso() // date civile NOUMÉA du matin servi
  const results = { digestDate, sitesProcessed: 0, quietSites: 0, totalSignalItems: 0, purged: 0, errors: 0 }

  // 1. Chantiers actifs (toutes organisations — le cron est service-role).
  const { data: sites, error: sitesErr } = await supabase
    .from('sites')
    .select('id, organization_id')
    .is('deleted_at', null)
    .eq('phase', 'actif')
    .order('created_at', { ascending: true })
    .limit(MAX_SITES_PER_RUN)

  if (sitesErr) {
    console.warn('[cron/night-digest] listing sites failed:', sitesErr.message)
    return NextResponse.json({ ok: false, reason: sitesErr.message }, { status: 500 })
  }

  // 2+3. Détecteurs puis persistance — séquentiel, échecs isolés.
  for (const site of sites ?? []) {
    const t0 = Date.now()
    try {
      const signals = await buildSiteMemorySignals(site.id as string, digestDate)
      const wrote = await writeSiteMorningDigest({
        siteId: site.id as string,
        organizationId: (site.organization_id as string | null) ?? null,
        digestDate,
        signals,
        durationMs: Date.now() - t0,
      })
      if (!wrote.ok) { results.errors++; continue }
      results.sitesProcessed++
      const itemCount = signals.reduce((n, s) => n + s.items.length, 0)
      results.totalSignalItems += itemCount
      if (itemCount === 0) results.quietSites++
    } catch {
      results.errors++
    }
  }

  // 4. Rétention : le digest sert LE matin, pas l'histoire.
  try {
    results.purged = await purgeOldDigests(RETENTION_DAYS)
  } catch {
    results.errors++
  }

  console.log('[cron/night-digest]', results)
  return NextResponse.json({ ok: true, ...results })
}
