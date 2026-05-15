// Cron de consolidation des lectures IA — filet de sécurité du fire-and-forget.
// Déclenchement : 02h00 Nouméa = 15h00 UTC (vercel.json).
//
// Ce que fait cette tâche :
//   1. Expire les candidats dont expires_at est dépassé.
//   2. Nettoie les candidats stale anciens (> 7 jours).
//   3. Identifie les sites avec nouveaux embeddings non encore reflétés.
//   4. Recalcule les lectures pour ces sites (SQL pur, jamais LLM).
//   5. Logue combien de sites ont été traités.
//
// Ce qu'elle ne fait PAS :
//   - Appeler un LLM ou l'API d'embeddings.
//   - Recalculer tous les sites à chaque run (max 30).
//   - Bloquer si un site échoue.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshSiteReadingCandidates } from '@/lib/ai/refresh-site-readings'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_SITES_PER_RUN = 30

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const results = {
    sitesRefreshed: 0,
    candidatesExpired: 0,
    candidatesCleaned: 0,
    errors: 0,
  }

  // 1. Expirer les candidats dont expires_at est dépassé
  const { error: expireErr } = await supabase
    .from('site_reading_candidates')
    .update({ status: 'stale' })
    .lt('expires_at', new Date().toISOString())
    .eq('status', 'active')

  if (expireErr) {
    console.warn('[cron/refresh-memory-readings] expire step failed:', expireErr.message)
    results.errors++
  }

  // 2. Supprimer les stales anciens (> 7 jours, évite accumulation silencieuse)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { error: cleanErr } = await supabase
    .from('site_reading_candidates')
    .delete()
    .eq('status', 'stale')
    .lt('generated_at', sevenDaysAgo)

  if (cleanErr) {
    console.warn('[cron/refresh-memory-readings] cleanup step failed:', cleanErr.message)
    results.errors++
  }

  // 3. Trouver les sites dont les embeddings sont plus récents que leurs candidats actifs
  //    (ou qui n'ont aucun candidat actif malgré des embeddings existants)
  const { data: embRows } = await supabase
    .from('trace_embeddings')
    .select('site_id, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const latestEmbBySite = new Map<string, string>()
  for (const row of (embRows ?? []) as Array<{ site_id: string; created_at: string }>) {
    if (!latestEmbBySite.has(row.site_id)) latestEmbBySite.set(row.site_id, row.created_at)
  }

  const { data: candRows } = await supabase
    .from('site_reading_candidates')
    .select('site_id, generated_at')
    .eq('status', 'active')
    .order('generated_at', { ascending: false })
    .limit(500)

  const latestCandBySite = new Map<string, string>()
  for (const row of (candRows ?? []) as Array<{ site_id: string; generated_at: string }>) {
    if (!latestCandBySite.has(row.site_id)) latestCandBySite.set(row.site_id, row.generated_at)
  }

  const sitesToRefresh: string[] = []
  for (const [siteId, latestEmb] of latestEmbBySite.entries()) {
    const latestCand = latestCandBySite.get(siteId)
    if (!latestCand || latestEmb > latestCand) sitesToRefresh.push(siteId)
    if (sitesToRefresh.length >= MAX_SITES_PER_RUN) break
  }

  // 4. Recalcul séquentiel — évite la surcharge mémoire, isole les échecs
  for (const siteId of sitesToRefresh) {
    try {
      await refreshSiteReadingCandidates(siteId)
      results.sitesRefreshed++
    } catch {
      results.errors++
    }
  }

  console.log('[cron/refresh-memory-readings]', results)
  return NextResponse.json({ ok: true, ...results })
}
