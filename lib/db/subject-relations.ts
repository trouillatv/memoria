// Dépendances entre sujets (migration 145) — « A BLOQUE B ».
//
// Une arête DIRIGÉE unique (from = bloqueur, to = bloqué). On la lit dans les deux
// sens : depuis A on voit « ce que A bloque » (from=A), depuis B on voit « ce qui
// bloque B / ce que B attend » (to=B). Déterministe, zéro IA, zéro score d'acteur.
// Création = acte HUMAIN (created_by). reason obligatoire, importance critique|normal.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import type { SubjectStatus } from '@/types/db'

export type RelationImportance = 'critique' | 'normal'

/** Un bout d'arête vu depuis un sujet : l'AUTRE sujet + la raison + l'importance. */
export interface SubjectRelationLite {
  relationId: string
  subjectId: string          // l'autre sujet (bloqué si on regarde « blocks », bloqueur si « blockedBy »)
  subjectName: string
  subjectStatus: SubjectStatus
  reason: string
  importance: RelationImportance
}

export interface SubjectRelations {
  blocks: SubjectRelationLite[]      // ce que CE sujet bloque (from = ce sujet)
  blockedBy: SubjectRelationLite[]   // ce qui bloque CE sujet (to = ce sujet) = « en attente de »
}

/** Crée une dépendance « from BLOQUE to ». Acte humain : userId obligatoire en amont. */
export async function createSubjectRelation(input: {
  fromSubjectId: string
  toSubjectId: string
  reason: string
  importance: RelationImportance
  userId: string | null
}): Promise<string> {
  if (input.fromSubjectId === input.toSubjectId) throw new Error('Un sujet ne peut pas se bloquer lui-même.')
  const reason = input.reason.trim()
  if (!reason) throw new Error('La raison du blocage est obligatoire.')
  const supabase = createAdminClient()
  const organization_id = await getOrgId().catch(() => null)
  const { data, error } = await supabase
    .from('subject_relation')
    .insert({
      organization_id,
      from_subject_id: input.fromSubjectId,
      to_subject_id: input.toSubjectId,
      reason,
      importance: input.importance,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id as string
}

export async function deleteSubjectRelation(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('subject_relation').delete().eq('id', id)
  if (error) throw error
}

/** Les deux faces des dépendances d'un sujet (ce qu'il bloque / ce qui le bloque). */
export async function getSubjectRelations(subjectId: string): Promise<SubjectRelations> {
  const supabase = createAdminClient()
  const [{ data: outRows }, { data: inRows }] = await Promise.all([
    supabase.from('subject_relation').select('id, to_subject_id, reason, importance').eq('from_subject_id', subjectId),
    supabase.from('subject_relation').select('id, from_subject_id, reason, importance').eq('to_subject_id', subjectId),
  ])
  const out = (outRows ?? []) as Array<{ id: string; to_subject_id: string; reason: string; importance: RelationImportance }>
  const inc = (inRows ?? []) as Array<{ id: string; from_subject_id: string; reason: string; importance: RelationImportance }>

  const otherIds = [...new Set([...out.map((r) => r.to_subject_id), ...inc.map((r) => r.from_subject_id)])]
  const names = new Map<string, { name: string; status: SubjectStatus }>()
  if (otherIds.length > 0) {
    const { data: subs } = await supabase.from('subjects').select('id, name, status').in('id', otherIds)
    for (const s of (subs ?? []) as Array<{ id: string; name: string; status: SubjectStatus }>) names.set(s.id, { name: s.name, status: s.status })
  }
  const lite = (relId: string, otherId: string, reason: string, importance: RelationImportance): SubjectRelationLite => ({
    relationId: relId, subjectId: otherId,
    subjectName: names.get(otherId)?.name ?? '(sujet supprimé)',
    subjectStatus: names.get(otherId)?.status ?? 'closed',
    reason, importance,
  })
  return {
    blocks: out.map((r) => lite(r.id, r.to_subject_id, r.reason, r.importance)),
    blockedBy: inc.map((r) => lite(r.id, r.from_subject_id, r.reason, r.importance)),
  }
}

/** IMPACT chantier (batché, briefing) : combien de sujets CHAQUE sujet bloque, et
 *  s'il en bloque au moins un de façon CRITIQUE. Dérivé, déterministe. */
export interface SubjectImpact { blocksCount: number; criticalImpact: boolean }
export async function getSubjectImpactCounts(subjectIds: string[]): Promise<Map<string, SubjectImpact>> {
  const out = new Map<string, SubjectImpact>(subjectIds.map((id) => [id, { blocksCount: 0, criticalImpact: false }]))
  if (subjectIds.length === 0) return out
  const supabase = createAdminClient()
  const { data } = await supabase.from('subject_relation').select('from_subject_id, importance').in('from_subject_id', subjectIds)
  for (const r of (data ?? []) as Array<{ from_subject_id: string; importance: RelationImportance }>) {
    const e = out.get(r.from_subject_id); if (!e) continue
    e.blocksCount += 1
    if (r.importance === 'critique') e.criticalImpact = true
  }
  return out
}
