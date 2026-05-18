// Pré-calcul des lectures sémantiques (résonances + persistances) pour un site.
// Appelé en fire-and-forget après chaque embedding réussi — jamais sur page load.
//
// Doctrine : la lourdeur pgvector est ici (écriture), la lecture est SQL pur.
// Ordre invariant : calculer → insérer → marquer stale (jamais l'inverse).
// Si l'insertion échoue, les lectures actives existantes sont conservées.

import { createAdminClient } from '@/lib/supabase/admin'

const RESONANCE_THRESHOLD = 0.65
const PERSISTENCE_THRESHOLD = 0.92
const VOICE_PERSISTENCE_THRESHOLD = 0.88
// Seuil plus bas pour consigne → note terrain : surveiller le bruit en pilote.
const VOICE_RESONANCE_THRESHOLD = 0.60
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

type AdminClient = ReturnType<typeof createAdminClient>

type SiteAnomalyRow = {
  id: string
  description: string | null
  category_other: string | null
  created_at: string
  status: string
}

/**
 * intervention_anomalies n'a pas de colonne site_id : on remonte la chaîne
 * site → missions → interventions → intervention_anomalies.
 * (Même jointure que lib/db/site-memory.ts — table réelle, pas `anomalies`.)
 */
async function fetchSiteAnomalies(
  supabase: AdminClient,
  siteId: string,
  limit: number,
): Promise<{ data: SiteAnomalyRow[] }> {
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => (m as { id: string }).id)
  if (missionIds.length === 0) return { data: [] }

  const { data: interventions } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventions ?? []).map((i) => (i as { id: string }).id)
  if (interventionIds.length === 0) return { data: [] }

  const { data } = await supabase
    .from('intervention_anomalies')
    .select('id, description, category_other, created_at, status')
    .in('intervention_id', interventionIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: (data ?? []) as SiteAnomalyRow[] }
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

      const { data: anomalyRows } = await fetchSiteAnomalies(supabase, siteId, 50)

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
      const { data: anomalyRows } = await fetchSiteAnomalies(supabase, siteId, 50)

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

  // -----------------------------------------------------------------------
  // PERSISTANCES TERRAIN — note terrain → note terrain, seuil 0.88
  // Fragments mémoire validés qui se répètent sur un même site.
  // Cap à 1 lecture de ce type — ne pas noyer les autres axes.
  // -----------------------------------------------------------------------
  try {
    const { data: vnEmbRows, error: embErr } = await supabase
      .from('trace_embeddings')
      .select('source_id, text_excerpt')
      .eq('source_type', 'intervention_note')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(15)
    if (embErr) logError('voice_persistence/fetch_embeddings', siteId, embErr.message)

    if ((vnEmbRows ?? []).length >= 2) {
      const seenPairs = new Set<string>()
      let vnPersistenceCount = 0

      for (const vnEmb of (vnEmbRows ?? []) as Array<{ source_id: string; text_excerpt: string }>) {
        if (vnPersistenceCount >= 1) break

        const { data: similar, error: rpcErr } = await supabase.rpc('find_similar_to_source', {
          p_source_id: vnEmb.source_id,
          p_target_type: 'intervention_note',
          p_limit: 3,
        })
        if (rpcErr) { logError('voice_persistence/rpc', siteId, rpcErr.message); continue }
        if (!similar) continue

        for (const match of similar as Array<{ source_id: string; similarity: number }>) {
          if (match.similarity < VOICE_PERSISTENCE_THRESHOLD) continue
          const pairKey = [vnEmb.source_id, match.source_id].sort().join(':')
          if (seenPairs.has(pairKey)) continue
          seenPairs.add(pairKey)

          const theme = short(vnEmb.text_excerpt, 55)
          if (!theme) continue

          newCandidates.push({
            tenant_id: tenantId,
            site_id: siteId,
            reading_type: 'persistence',
            fragment: `${theme.toLowerCase()} — revient en note terrain.`,
            source_ids: [vnEmb.source_id, match.source_id],
            internal_score: match.similarity,
          })
          vnPersistenceCount++
          break
        }
      }
    }
  } catch (e) { logError('voice_persistence', siteId, e) }

  // -----------------------------------------------------------------------
  // RÉSONANCES TERRAIN — consigne (site_note) → note terrain, seuil 0.60
  // Garde-fous : min 7 jours d'écart, cap à 1 lecture de ce type.
  // Seuil délibérément plus bas — surveiller le bruit lors du pilote.
  // -----------------------------------------------------------------------
  try {
    const { data: embeddedNotes, error: embErr } = await supabase
      .from('trace_embeddings')
      .select('source_id')
      .eq('source_type', 'site_note')
      .eq('site_id', siteId)
      .limit(10)
    if (embErr) logError('voice_resonance/fetch_embeddings', siteId, embErr.message)

    // Pré-charger les dates des notes terrain pour le garde-fou 7 jours.
    const { data: vnDateRows } = await supabase
      .from('trace_embeddings')
      .select('source_id, created_at')
      .eq('source_type', 'intervention_note')
      .eq('site_id', siteId)
      .limit(20)
    const vnDateMap = new Map(
      ((vnDateRows ?? []) as Array<{ source_id: string; created_at: string }>)
        .map((r) => [r.source_id, r.created_at])
    )

    if ((embeddedNotes ?? []).length > 0 && vnDateMap.size > 0) {
      const { data: siteNoteRows } = await supabase
        .from('site_notes')
        .select('id, body, created_at')
        .eq('site_id', siteId)
        .is('deleted_at', null)

      let voiceResonanceCount = 0

      for (const noteEmb of (embeddedNotes ?? []) as Array<{ source_id: string }>) {
        if (voiceResonanceCount >= 1) break

        const { data: similar, error: rpcErr } = await supabase.rpc('find_similar_to_source', {
          p_source_id: noteEmb.source_id,
          p_target_type: 'intervention_note',
          p_limit: 3,
        })
        if (rpcErr) { logError('voice_resonance/rpc', siteId, rpcErr.message); continue }
        if (!similar) continue

        for (const match of similar as Array<{ source_id: string; similarity: number }>) {
          if (match.similarity < VOICE_RESONANCE_THRESHOLD) continue

          const noteRow = (siteNoteRows ?? []).find((n) => n.id === noteEmb.source_id) as
            | { id: string; body: string; created_at: string } | undefined
          if (!noteRow) continue

          const vnCreatedAt = vnDateMap.get(match.source_id)
          if (!vnCreatedAt) continue

          const noteTime = new Date(noteRow.created_at).getTime()
          const vnTime = new Date(vnCreatedAt).getTime()
          if (Math.abs(vnTime - noteTime) < SEPT_JOURS) continue

          const noteShort = short(noteRow.body, 50)
          const noteMonth = monthYearLabel(noteRow.created_at).toLowerCase()

          newCandidates.push({
            tenant_id: tenantId,
            site_id: siteId,
            reading_type: 'resonance',
            fragment: `Consigne de ${noteMonth} (« ${noteShort} ») — note terrain concordante.`,
            source_ids: [noteEmb.source_id, match.source_id],
            internal_score: match.similarity,
          })
          voiceResonanceCount++
          break
        }
      }
    }
  } catch (e) { logError('voice_resonance', siteId, e) }

  // -----------------------------------------------------------------------
  // Insérer les nouveaux candidats AVANT de passer les anciens en stale.
  // Si l'insertion échoue, les lectures actives existantes sont conservées.
  // beforeInsert garantit qu'on ne stale pas ce qu'on vient d'insérer.
  // -----------------------------------------------------------------------
  const beforeInsert = new Date().toISOString()

  const insertedOk = await (async () => {
    if (newCandidates.length === 0) return false
    try {
      const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString()
      const { error } = await supabase.from('site_reading_candidates').insert(
        newCandidates.map((c) => ({ ...c, expires_at: expiresAt })),
      )
      if (error) { logError('insert_candidates', siteId, error.message); return false }
      return true
    } catch (e) { logError('insert_candidates', siteId, e); return false }
  })()

  // Marquer stale les anciens candidats uniquement si de nouveaux ont bien été insérés.
  // generated_at < beforeInsert = les nouveaux ne sont pas touchés.
  if (insertedOk) {
    try {
      const { error } = await supabase
        .from('site_reading_candidates')
        .update({ status: 'stale' })
        .eq('site_id', siteId)
        .eq('status', 'active')
        .lt('generated_at', beforeInsert)
      if (error) logError('mark_stale', siteId, error.message)
    } catch (e) { logError('mark_stale', siteId, e) }
  }
}
