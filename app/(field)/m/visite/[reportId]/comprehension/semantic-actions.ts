'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeAlias } from '@/lib/knowledge/semantic-entities'
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'

// Ajoute un candidat à la liste des ignorés pour ce débrief.
export async function ignoreCandidat(reportId: string, rawText: string): Promise<void> {
  const db = createAdminClient()
  const { data } = await db
    .from('site_reports')
    .select('debrief_analysis')
    .eq('id', reportId)
    .maybeSingle()
  const analysis = data?.debrief_analysis as StoredDebriefAnalysis | null
  if (!analysis?.semantic_memory) return

  const current = analysis.semantic_memory.ignored_candidates ?? []
  if (current.includes(rawText)) return

  await db
    .from('site_reports')
    .update({
      debrief_analysis: {
        ...analysis,
        semantic_memory: {
          ...analysis.semantic_memory,
          ignored_candidates: [...current, rawText],
        },
      },
    })
    .eq('id', reportId)

  revalidatePath(`/m/visite/${reportId}/comprehension`)
}

// Crée une nouvelle entité org depuis un candidat non résolu, puis invalide la cache.
// Portée org par défaut — l'utilisateur peut affiner dans la gestion des entités.
export async function addEntityFromCandidat(
  reportId: string,
  orgId: string,
  rawText: string,
  entityType: 'person' | 'company',
): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient()

  const { data: entity, error: entityErr } = await db
    .from('site_knowledge_entities')
    .insert({
      organization_id: orgId,
      canonical_label: rawText,
      entity_type: entityType,
      confidence: 1.0,
      is_active: true,
      source: 'manual',
      metadata: {},
    })
    .select('id')
    .single()

  if (entityErr || !entity) {
    return { ok: false, error: entityErr?.message ?? 'Erreur création entité' }
  }

  const { error: aliasErr } = await db.from('site_knowledge_entity_aliases').insert({
    entity_id: entity.id,
    alias: rawText,
    alias_norm: normalizeAlias(rawText),
  })

  if (aliasErr) {
    return { ok: false, error: aliasErr.message }
  }

  revalidatePath(`/m/visite/${reportId}/comprehension`)
  return { ok: true }
}

// Crée un alias sur une entité existante depuis un candidat non résolu.
export async function associerCandidat(
  reportId: string,
  entityId: string,
  rawText: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient()

  const { error } = await db.from('site_knowledge_entity_aliases').insert({
    entity_id: entityId,
    alias: rawText,
    alias_norm: normalizeAlias(rawText),
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  revalidatePath(`/m/visite/${reportId}/comprehension`)
  return { ok: true }
}
