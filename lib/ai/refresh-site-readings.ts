// Pré-calcul des lectures sémantiques (résonances + persistances) pour un site.
// Appelé en fire-and-forget après chaque embedding réussi — jamais sur page load.
//
// Doctrine : la lourdeur pgvector est ici (écriture), la lecture est SQL pur.

import { createAdminClient } from '@/lib/supabase/admin'

const RESONANCE_THRESHOLD = 0.65
const PERSISTENCE_THRESHOLD = 0.92
const SEPT_JOURS = 7 * 86_400_000

function logError(source: string, siteId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(JSON.stringify({
    service: 'refresh-site-readings',
    source,
    site_id: siteId,
    error: message,
    ts: new Date().toISOString(),
  }))
}

function monthYearLabel(isoDate: string): string {
  const d = new Date(isoDate)
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

function short(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

export async function refreshSiteReadingCandidates(siteId: string): Promise<void> {
  const supabase = createAdminClient()

  // Récupérer tenant_id du site
  let tenantId: string
  try {
    const { data: site, error } = await supabase
      .from('sites')
      .select('tenant_id')
      .eq('id', siteId)
      .maybeSingle()
    if (error) { logError('fetch_site', siteId, error.message); return }
    if (!(site as { tenant_id?: string } | null)?.tenant_id) return
    tenantId = (site as { tenant_id: string }).tenant_id
  } catch (e) { logError('fetch_site', siteId, e); return }

  // Marquer les candidats existants comme stale
  try {
    const { error } = await supabase
      .from('site_reading_candidates')
      .update({ status: 'stale' })
      .eq('site_id', siteId)
      .eq('status', 'active')
    if (error) logError('mark_stale', siteId, error.message)
  } catch (e) { logError('mark_stale', siteId, e) }

  const newCandidates: Array<{
    tenant_id: string
    site_id: string
    reading_type: string
    fragment: string
    source_ids: string[]
    internal_score: number
  }> = []

  // -----------------------------------------------------------------------
  // RÉSONANCES — consigne (site_note) → anomalie, seuil 0.65
  // -----------------------------------------------------------------------
  try {
    const { data: embeddedNotes, error: embErr } = await supabase
      .from('trace_embeddings')
      .select('source_id')
      .eq('source_type', 'site_note')
      .eq('site_id', siteId)
      .limit(10)
    if (embErr) logError('resonance/fetch_embeddings', siteId, embErr.message)

    if ((embeddedNotes ?? []).length > 0) {
      const { data: siteNoteRows } = await supabase
        .from('site_notes')
        .select('id, body, created_at')
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      const { data: anomalyRows } = await supabase
        .from('anomalies')
        .select('id, description, category_other, created_at, status')
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)

      const seenAnomalies = new Set<string>()
      let resonanceCount = 0

      for (const noteEmb of (embeddedNotes ?? []) as Array<{ source_id: string }>) {
        if (resonanceCount >= 2) break

        const { data: similar, error: rpcErr } = await supabase.rpc('find_similar_to_source', {
          p_source_id: noteEmb.source_id,
          p_target_type: 'anomaly',
          p_limit: 3,
        })
        if (rpcErr) { logError('resonance/rpc', siteId, rpcErr.message); continue }
        if (!similar) continue

        for (const match of similar as Array<{ source_id: string; similarity: number }>) {
          if (match.similarity < RESONANCE_THRESHOLD) continue
          if (seenAnomalies.has(match.source_id)) continue

          const noteRow = (siteNoteRows ?? []).find((n) => n.id === noteEmb.source_id) as
            | { id: string; body: string; created_at: string } | undefined
          const anomalyRow = (anomalyRows ?? []).find((a) => a.id === match.source_id) as
            | { id: string; description?: string; category_other?: string; created_at: string } | undefined
          if (!noteRow || !anomalyRow) continue

          const noteTime = new Date(noteRow.created_at).getTime()
          const anomalyTime = new Date(anomalyRow.created_at).getTime()
          if (anomalyTime - noteTime < SEPT_JOURS) continue

          const noteShort = short(noteRow.body, 60)
          const anomalyText = anomalyRow.description ?? anomalyRow.category_other ?? ''
          const anomalyShort = short(anomalyText, 50)
          const noteMonth = monthYearLabel(noteRow.created_at).toLowerCase()

          newCandidates.push({
            tenant_id: tenantId,
            site_id: siteId,
            reading_type: 'resonance',
            fragment: `Consigne de ${noteMonth} (« ${noteShort} ») → anomalie « ${anomalyShort.toLowerCase()} ».`,
            source_ids: [noteEmb.source_id, match.source_id],
            internal_score: match.similarity,
          })
          seenAnomalies.add(match.source_id)
          resonanceCount++
          if (resonanceCount >= 2) break
        }
      }
    }
  } catch (e) { logError('resonance', siteId, e) }

  // -----------------------------------------------------------------------
  // PERSISTANCES — thème d'anomalie récurrent, seuil 0.92
  // -----------------------------------------------------------------------
  try {
    const { data: embeddedAnomalies, error: embErr } = await supabase
      .from('trace_embeddings')
      .select('source_id')
      .eq('source_type', 'anomaly')
      .eq('site_id', siteId)
      .limit(10)
    if (embErr) logError('persistence/fetch_embeddings', siteId, embErr.message)

    if ((embeddedAnomalies ?? []).length >= 2) {
      const { data: anomalyRows } = await supabase
        .from('anomalies')
        .select('id, description, category_other')
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .limit(50)

      const seenPairs = new Set<string>()
      let persistenceCount = 0

      for (const anomalyEmb of (embeddedAnomalies ?? []) as Array<{ source_id: string }>) {
        if (persistenceCount >= 2) break

        const { data: similar, error: rpcErr } = await supabase.rpc('find_similar_to_source', {
          p_source_id: anomalyEmb.source_id,
          p_target_type: 'anomaly',
          p_limit: 3,
        })
        if (rpcErr) { logError('persistence/rpc', siteId, rpcErr.message); continue }
        if (!similar) continue

        for (const match of similar as Array<{ source_id: string; similarity: number }>) {
          if (match.similarity < PERSISTENCE_THRESHOLD) continue
          const pairKey = [anomalyEmb.source_id, match.source_id].sort().join(':')
          if (seenPairs.has(pairKey)) continue
          seenPairs.add(pairKey)

          const anomalyRow = (anomalyRows ?? []).find((a) => a.id === anomalyEmb.source_id) as
            | { description?: string; category_other?: string } | undefined
          if (!anomalyRow) continue
          const theme = (anomalyRow.description ?? anomalyRow.category_other ?? '').slice(0, 55)
          if (!theme) continue

          newCandidates.push({
            tenant_id: tenantId,
            site_id: siteId,
            reading_type: 'persistence',
            fragment: `«${theme.toLowerCase()}» — signalé à nouveau.`,
            source_ids: [anomalyEmb.source_id, match.source_id],
            internal_score: match.similarity,
          })
          persistenceCount++
          if (persistenceCount >= 2) break
        }
      }
    }
  } catch (e) { logError('persistence', siteId, e) }

  // Insérer les nouveaux candidats (expire dans 14 jours — filet de sécurité cron)
  if (newCandidates.length > 0) {
    try {
      const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString()
      const { error } = await supabase.from('site_reading_candidates').insert(
        newCandidates.map((c) => ({ ...c, expires_at: expiresAt })),
      )
      if (error) logError('insert_candidates', siteId, error.message)
    } catch (e) { logError('insert_candidates', siteId, e) }
  }
}
