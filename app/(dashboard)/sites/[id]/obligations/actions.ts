'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { instantiateObligations, setObligationStatus } from '@/lib/db/obligations'

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
