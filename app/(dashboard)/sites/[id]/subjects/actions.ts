'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createSubject, setSubjectStatus, attachToSubject, findSubjectByName, renameSubject } from '@/lib/db/subjects'
import { createSubjectRelation, deleteSubjectRelation } from '@/lib/db/subject-relations'
import { addDocumentLink } from '@/lib/db/documents'
import type { SubjectStatus } from '@/types/db'

type Result = { ok: true; id?: string } | { error: string }

async function getOperator() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  if (user.role !== 'admin' && user.role !== 'manager') return null
  return user
}

const createSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().trim().min(1, 'Nom requis').max(160),
  scopeId: z.string().uuid().nullable(),
})

export async function createSubjectAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = createSchema.safeParse({
    siteId: formData.get('siteId'),
    name: formData.get('name'),
    scopeId: ((formData.get('scopeId') as string | null) ?? '') || null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  // Anti-doublon (doctrine sujet) : un même objet métier ne doit pas exister deux fois.
  const existing = await findSubjectByName(parsed.data.siteId, parsed.data.name)
  if (existing) return { error: `Un sujet « ${existing.name} » existe déjà sur ce chantier.` }
  const id = await createSubject({
    siteId: parsed.data.siteId, name: parsed.data.name, scopeId: parsed.data.scopeId, userId: operator.id,
  })
  revalidatePath(`/sites/${parsed.data.siteId}/subjects`)
  return { ok: true, id }
}

const renameSchema = z.object({
  siteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  name: z.string().trim().min(1, 'Nom requis').max(160),
})

/** Renomme un point suivi (anti-doublon : un autre point ne doit pas déjà porter ce nom). */
export async function renameSubjectAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = renameSchema.safeParse({
    siteId: formData.get('siteId'),
    subjectId: formData.get('subjectId'),
    name: formData.get('name'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const existing = await findSubjectByName(parsed.data.siteId, parsed.data.name)
  if (existing && existing.id !== parsed.data.subjectId) return { error: `Un point « ${existing.name} » existe déjà sur ce chantier.` }
  await renameSubject(parsed.data.subjectId, parsed.data.name)
  revalidatePath(`/sites/${parsed.data.siteId}/subjects/${parsed.data.subjectId}`)
  revalidatePath(`/sites/${parsed.data.siteId}/subjects`)
  return { ok: true }
}

const statusSchema = z.object({
  siteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  status: z.enum(['open', 'dormant', 'closed']),
})

export async function setSubjectStatusAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = statusSchema.safeParse({
    siteId: formData.get('siteId'),
    subjectId: formData.get('subjectId'),
    status: formData.get('status'),
  })
  if (!parsed.success) return { error: 'Statut invalide' }
  await setSubjectStatus(parsed.data.subjectId, parsed.data.status as SubjectStatus)
  revalidatePath(`/sites/${parsed.data.siteId}/subjects/${parsed.data.subjectId}`)
  revalidatePath(`/sites/${parsed.data.siteId}/subjects`)
  return { ok: true }
}

const attachSchema = z.object({
  siteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  kind: z.enum(['action', 'reserve', 'decision', 'document', 'anomaly', 'added_anomaly']),
  rowId: z.string().uuid(),
})

const KIND_TABLE = {
  action: 'site_actions',
  reserve: 'site_reserve',
  decision: 'site_report_proposals',
  anomaly: 'intervention_anomalies',
  added_anomaly: 'report_added_points',
} as const

/** Rattache un objet existant (action/réserve/décision/document) à un sujet. */
export async function attachToSubjectAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = attachSchema.safeParse({
    siteId: formData.get('siteId'),
    subjectId: formData.get('subjectId'),
    kind: formData.get('kind'),
    rowId: formData.get('rowId'),
  })
  if (!parsed.success) return { error: 'Rattachement invalide' }

  if (parsed.data.kind === 'document') {
    await addDocumentLink(parsed.data.rowId, 'subject', parsed.data.subjectId)
  } else {
    await attachToSubject(KIND_TABLE[parsed.data.kind], parsed.data.rowId, parsed.data.subjectId)
  }
  revalidatePath(`/sites/${parsed.data.siteId}/subjects/${parsed.data.subjectId}`)
  return { ok: true }
}

// ── Dépendances entre sujets (migration 145) — « ce sujet BLOQUE … ». Acte humain. ──

const relationSchema = z.object({
  siteId: z.string().uuid(),
  subjectId: z.string().uuid(),        // le BLOQUEUR (sujet de la page)
  targetSubjectId: z.string().uuid(),  // le BLOQUÉ
  reason: z.string().trim().min(1, 'La raison du blocage est obligatoire').max(300),
  importance: z.enum(['critique', 'normal']),
})

export async function createSubjectRelationAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = relationSchema.safeParse({
    siteId: formData.get('siteId'),
    subjectId: formData.get('subjectId'),
    targetSubjectId: formData.get('targetSubjectId'),
    reason: formData.get('reason'),
    importance: formData.get('importance'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  if (parsed.data.subjectId === parsed.data.targetSubjectId) return { error: 'Un sujet ne peut pas se bloquer lui-même.' }
  try {
    await createSubjectRelation({
      fromSubjectId: parsed.data.subjectId, toSubjectId: parsed.data.targetSubjectId,
      reason: parsed.data.reason, importance: parsed.data.importance, userId: operator.id,
    })
  } catch {
    return { error: 'Cette dépendance existe déjà ou est invalide.' }
  }
  revalidatePath(`/sites/${parsed.data.siteId}/subjects/${parsed.data.subjectId}`)
  return { ok: true }
}

const deleteRelationSchema = z.object({
  siteId: z.string().uuid(),
  subjectId: z.string().uuid(),
  relationId: z.string().uuid(),
})

export async function deleteSubjectRelationAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = deleteRelationSchema.safeParse({
    siteId: formData.get('siteId'),
    subjectId: formData.get('subjectId'),
    relationId: formData.get('relationId'),
  })
  if (!parsed.success) return { error: 'Suppression invalide' }
  await deleteSubjectRelation(parsed.data.relationId)
  revalidatePath(`/sites/${parsed.data.siteId}/subjects/${parsed.data.subjectId}`)
  return { ok: true }
}
