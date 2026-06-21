'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { instantiateObligations, setObligationStatus, setObligationImportance, setObligationResponsible, markObligationReminded } from '@/lib/db/obligations'

type Result = { ok: true; count?: number } | { error: string }

async function getOperator() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  if (user.role !== 'admin' && user.role !== 'manager') return null
  return user
}

const instantiateSchema = z.object({
  siteId: z.string().uuid(),
  templateIds: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins une obligation'),
})

/** Injection au démarrage : l'humain a validé la sélection de la bibliothèque. */
export async function instantiateObligationsAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = instantiateSchema.safeParse({
    siteId: formData.get('siteId'),
    templateIds: formData.getAll('templateIds'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const count = await instantiateObligations(parsed.data.siteId, parsed.data.templateIds, operator.id)
  revalidatePath(`/sites/${parsed.data.siteId}/obligations`)
  return { ok: true, count }
}

const statusSchema = z.object({
  siteId: z.string().uuid(),
  obligationId: z.string().uuid(),
  status: z.enum(['a_produire', 'en_cours', 'satisfaite', 'non_applicable']),
})

export async function setObligationStatusAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = statusSchema.safeParse({
    siteId: formData.get('siteId'),
    obligationId: formData.get('obligationId'),
    status: formData.get('status'),
  })
  if (!parsed.success) return { error: 'Statut invalide' }
  await setObligationStatus(parsed.data.obligationId, parsed.data.status)
  revalidatePath(`/sites/${parsed.data.siteId}/obligations`)
  return { ok: true }
}

const importanceSchema = z.object({
  siteId: z.string().uuid(),
  obligationId: z.string().uuid(),
  importance: z.enum(['critique', 'haute', 'moyenne']),
})

export async function setObligationImportanceAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = importanceSchema.safeParse({
    siteId: formData.get('siteId'), obligationId: formData.get('obligationId'), importance: formData.get('importance'),
  })
  if (!parsed.success) return { error: 'Criticité invalide' }
  await setObligationImportance(parsed.data.obligationId, parsed.data.importance)
  revalidatePath(`/sites/${parsed.data.siteId}/obligations`)
  return { ok: true }
}

const responsibleSchema = z.object({
  siteId: z.string().uuid(),
  obligationId: z.string().uuid(),
  responsible: z.string().trim().min(1, 'Responsable requis').max(120),
})

export async function setObligationResponsibleAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = responsibleSchema.safeParse({
    siteId: formData.get('siteId'), obligationId: formData.get('obligationId'), responsible: formData.get('responsible'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  await setObligationResponsible(parsed.data.obligationId, parsed.data.responsible)
  revalidatePath(`/sites/${parsed.data.siteId}/obligations`)
  return { ok: true }
}

const remindSchema = z.object({ siteId: z.string().uuid(), obligationId: z.string().uuid() })

export async function markObligationRemindedAction(formData: FormData): Promise<Result> {
  const operator = await getOperator()
  if (!operator) return { error: 'Non autorisé' }
  const parsed = remindSchema.safeParse({ siteId: formData.get('siteId'), obligationId: formData.get('obligationId') })
  if (!parsed.success) return { error: 'Requête invalide' }
  await markObligationReminded(parsed.data.obligationId)
  revalidatePath(`/sites/${parsed.data.siteId}/obligations`)
  return { ok: true }
}
