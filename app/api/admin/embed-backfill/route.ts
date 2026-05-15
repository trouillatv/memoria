// Route admin : backfill des embeddings sur les traces historiques.
//
// Usage (admin uniquement) :
//   POST /api/admin/embed-backfill
//   Header: x-internal-trigger: <INTERNAL_ANALYZE_SECRET>
//
// Traite par batch de 50 : appeler plusieurs fois pour tout backfiller.
// Idempotent : les traces déjà embeddées sont skippées (UPSERT côté DB).
//
// Pré-requis : GOOGLE_GENAI_API_KEY (ou OPENAI_API_KEY / VOYAGE_API_KEY) dans l'env.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedAndStoreTrace, embedAnomalyTrace } from '@/lib/ai/embed-trace'
import { getActiveProvider } from '@/lib/ai/embeddings'

const BATCH = 50

export async function POST(req: Request) {
  const expected = process.env.INTERNAL_ANALYZE_SECRET
  const got = req.headers.get('x-internal-trigger')
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const provider = getActiveProvider()
  if (provider === null) {
    return NextResponse.json(
      { error: 'Aucun provider configuré. Définir OPENAI_API_KEY ou VOYAGE_API_KEY.' },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  let embedded = 0
  let skipped = 0
  const errors: string[] = []

  // ---- 1. Anomalies avec description ----------------------------------------
  const { data: anomalies } = await supabase
    .from('intervention_anomalies')
    .select('id, description, intervention_id')
    .not('description', 'is', null)
    .order('created_at', { ascending: false })
    .limit(BATCH)

  // Récupère les source_ids déjà embeddés pour ce batch
  const anomalyIds = ((anomalies ?? []) as Array<{ id: string }>).map((a) => a.id)
  const { data: existingAnomaly } = anomalyIds.length > 0
    ? await supabase
        .from('trace_embeddings')
        .select('source_id')
        .eq('source_type', 'anomaly')
        .in('source_id', anomalyIds)
    : { data: [] }
  const alreadyAnomaly = new Set(((existingAnomaly ?? []) as Array<{ source_id: string }>).map((r) => r.source_id))

  for (const a of (anomalies ?? []) as Array<{ id: string; description: string; intervention_id: string }>) {
    if (alreadyAnomaly.has(a.id)) { skipped++; continue }
    if (!a.description?.trim()) { skipped++; continue }
    try {
      // embedAnomalyTrace appelle embedAndStoreTrace en interne qui retourne bool
      // On ne peut pas vérifier le bool ici (void), mais au moins on logue les erreurs
      await embedAnomalyTrace({ anomalyId: a.id, interventionId: a.intervention_id, text: a.description })
      embedded++
    } catch (e) {
      errors.push(`anomaly:${a.id} — ${e}`)
    }
  }

  // ---- 2. Notes de site -------------------------------------------------------
  const { data: notes } = await supabase
    .from('site_notes')
    .select('id, site_id, body')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(BATCH)

  const noteIds = ((notes ?? []) as Array<{ id: string }>).map((n) => n.id)
  const { data: existingNotes } = noteIds.length > 0
    ? await supabase
        .from('trace_embeddings')
        .select('source_id')
        .eq('source_type', 'site_note')
        .in('source_id', noteIds)
    : { data: [] }
  const alreadyNotes = new Set(((existingNotes ?? []) as Array<{ source_id: string }>).map((r) => r.source_id))

  for (const n of (notes ?? []) as Array<{ id: string; site_id: string; body: string }>) {
    if (alreadyNotes.has(n.id)) { skipped++; continue }
    if (!n.body?.trim()) { skipped++; continue }
    try {
      const ok = await embedAndStoreTrace({ sourceType: 'site_note', sourceId: n.id, siteId: n.site_id, text: n.body })
      if (ok) embedded++; else errors.push(`site_note:${n.id} — embedAndStoreTrace returned false`)
    } catch (e) {
      errors.push(`site_note:${n.id} — ${e}`)
    }
  }

  // ---- 3. Notes d'intervention (interventions.notes) -------------------------
  const { data: intNotes } = await supabase
    .from('interventions')
    .select('id, notes, mission_id')
    .not('notes', 'is', null)
    .not('notes', 'eq', '')
    .order('executed_at', { ascending: false })
    .limit(BATCH)

  const intIds = ((intNotes ?? []) as Array<{ id: string }>).map((i) => i.id)
  const { data: existingInt } = intIds.length > 0
    ? await supabase
        .from('trace_embeddings')
        .select('source_id')
        .eq('source_type', 'intervention_note')
        .in('source_id', intIds)
    : { data: [] }
  const alreadyInt = new Set(((existingInt ?? []) as Array<{ source_id: string }>).map((r) => r.source_id))

  // Pour les notes d'intervention, besoin du site_id via mission
  type IntRow = { id: string; notes: string; mission_id: string }
  const intNotesArr = (intNotes ?? []) as IntRow[]
  const missionIdsNeeded = Array.from(new Set(intNotesArr.map((i) => i.mission_id)))
  const { data: missionsRows } = missionIdsNeeded.length > 0
    ? await supabase.from('missions').select('id, site_id').in('id', missionIdsNeeded)
    : { data: [] }
  const siteByMission = new Map(((missionsRows ?? []) as Array<{ id: string; site_id: string }>).map((m) => [m.id, m.site_id]))

  for (const i of intNotesArr) {
    if (alreadyInt.has(i.id)) { skipped++; continue }
    if (!i.notes?.trim()) { skipped++; continue }
    const siteId = siteByMission.get(i.mission_id)
    if (!siteId) { skipped++; continue }
    try {
      const ok = await embedAndStoreTrace({ sourceType: 'intervention_note', sourceId: i.id, siteId, text: i.notes })
      if (ok) embedded++; else errors.push(`intervention_note:${i.id} — embedAndStoreTrace returned false`)
    } catch (e) {
      errors.push(`intervention_note:${i.id} — ${e}`)
    }
  }

  return NextResponse.json({
    provider,
    embedded,
    skipped,
    errors,
    message: embedded > 0
      ? `${embedded} traces embeddées. Rappeler pour continuer si d'autres restent.`
      : 'Aucune trace à embedder dans ce batch.',
  })
}
