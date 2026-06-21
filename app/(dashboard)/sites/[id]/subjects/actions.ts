'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createSubject, setSubjectStatus, attachToSubject } from '@/lib/db/subjects'
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
  const id = await createSubject({
    siteId: parsed.data.siteId, name: parsed.data.name, scopeId: parsed.data.scopeId, userId: operator.id,
  })
  revalidatePath(`/sites/${parsed.data.siteId}/subjects`)
  return { ok: true, id }
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
