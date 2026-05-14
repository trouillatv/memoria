// V1.5 — Backfill embeddings (Vincent 2026-05-15).
//
// À exécuter UNE FOIS après avoir :
//   1. Appliqué la migration 052_pgvector_trace_embeddings.sql
//   2. Défini OPENAI_API_KEY ou VOYAGE_API_KEY en env
//
// Usage :
//   npx tsx scripts/dev/backfill-embeddings.ts
//
// Idempotent — peut être relancé sans risque (UNIQUE constraint + UPSERT).
//
// Le script :
//   - parcourt site_notes, intervention_anomalies, intervention_photos (caption)
//   - calcule un embedding pour chaque texte non vide ≥ 4 chars
//   - upserte dans trace_embeddings
//
// Coût attendu pilote AGP (5 sites, ~200 traces) : ~0.001$.

import { createAdminClient } from '@/lib/supabase/admin'
import { embedAndStoreTrace } from '@/lib/ai/embed-trace'
import { getActiveProvider } from '@/lib/ai/embeddings'

async function backfill() {
  const provider = getActiveProvider()
  if (!provider) {
    console.error('[backfill] Aucune clé API embeddings. Définir OPENAI_API_KEY ou VOYAGE_API_KEY.')
    process.exit(1)
  }
  console.log(`[backfill] Provider actif : ${provider}`)

  const supabase = createAdminClient()
  let total = 0
  let stored = 0

  // 1. site_notes
  const { data: notes } = await supabase
    .from('site_notes')
    .select('id, site_id, body')
    .is('deleted_at', null)
  for (const n of (notes ?? []) as Array<{ id: string; site_id: string; body: string }>) {
    total += 1
    const ok = await embedAndStoreTrace({
      sourceType: 'site_note',
      sourceId: n.id,
      siteId: n.site_id,
      text: n.body,
    })
    if (ok) stored += 1
  }
  console.log(`[backfill] site_notes : ${stored}/${total}`)

  // 2. intervention_anomalies (via interventions → missions → sites)
  const { data: anomalies } = await supabase
    .from('intervention_anomalies')
    .select(
      'id, description, category, category_other, intervention:interventions(mission:missions(site_id))',
    )
  let aStored = 0
  let aTotal = 0
  for (const a of (anomalies ?? []) as unknown as Array<{
    id: string
    description: string | null
    category: string
    category_other: string | null
    intervention: { mission: { site_id: string } | { site_id: string }[] } | null
  }>) {
    const mission = Array.isArray(a.intervention?.mission)
      ? a.intervention?.mission[0]
      : a.intervention?.mission
    const siteId = mission?.site_id
    if (!siteId) continue
    const text = a.description ?? a.category_other ?? a.category
    if (!text) continue
    aTotal += 1
    const ok = await embedAndStoreTrace({
      sourceType: 'anomaly',
      sourceId: a.id,
      siteId,
      text,
    })
    if (ok) aStored += 1
  }
  console.log(`[backfill] anomalies : ${aStored}/${aTotal}`)

  // 3. intervention_photos.caption
  const { data: photos } = await supabase
    .from('intervention_photos')
    .select(
      'id, caption, intervention:interventions(mission:missions(site_id))',
    )
    .not('caption', 'is', null)
  let pStored = 0
  let pTotal = 0
  for (const p of (photos ?? []) as unknown as Array<{
    id: string
    caption: string | null
    intervention: { mission: { site_id: string } | { site_id: string }[] } | null
  }>) {
    const mission = Array.isArray(p.intervention?.mission)
      ? p.intervention?.mission[0]
      : p.intervention?.mission
    const siteId = mission?.site_id
    if (!siteId || !p.caption) continue
    pTotal += 1
    const ok = await embedAndStoreTrace({
      sourceType: 'photo_caption',
      sourceId: p.id,
      siteId,
      text: p.caption,
    })
    if (ok) pStored += 1
  }
  console.log(`[backfill] photo_captions : ${pStored}/${pTotal}`)

  console.log('\n[backfill] terminé.')
}

backfill().catch((e) => {
  console.error('[backfill] erreur fatale', e)
  process.exit(1)
})
