'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { runEngagementExtractionAgent } from '@/services/ai/engagement-extraction'
import {
  activateEngagementsForContract,
  archiveEngagement,
  bulkInsertEngagements,
  createEngagementManual,
  curateEngagement,
  hasLinkedInterventions,
  listEngagementsByTender,
  rejectEngagements,
} from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'
import { getTender, getTenderDocument, getLatestTenderAnalysis } from '@/lib/db/tenders'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'

const extractSchema = z.object({ tender_id: z.string().uuid() })

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

export async function extractEngagementsAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = extractSchema.safeParse({ tender_id: formData.get('tender_id') })
  if (!parsed.success) return { error: 'Invalid input' }

  const existing = await listEngagementsByTender(parsed.data.tender_id)
  if (existing.length > 0) return { error: 'Engagements déjà extraits pour ce dossier' }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'Dossier introuvable' }

  const [doc, analysis] = await Promise.all([
    getTenderDocument(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
  ])
  if (!doc?.extracted_text) return { error: 'Pas de texte extrait sur le document du dossier' }

  const result = await runEngagementExtractionAgent({
    aoText: doc.extracted_text,
    memoireTechniqueText: analysis?.technical_memo ?? null,
    userId: auth.userId,
  })

  await bulkInsertEngagements({
    tender_id: parsed.data.tender_id,
    created_by: auth.userId,
    engagements: result.engagements,
  })

  revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
  return { ok: true as const, count: result.engagements.length }
}

const curateSchema = z.object({
  id: z.string().uuid(),
  short_label: z.string().min(3).max(100).optional(),
  category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']).optional(),
  measurable: z.boolean().optional(),
  proof_requirement: z.enum(['photo', 'anomaly_documented', 'none']).optional(),
  destination: z.enum(['contract_engagement', 'vigilance', 'a_savoir', 'mission']).optional(),
})

export async function curateEngagementAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const measurableRaw = formData.get('measurable')
  const measurable = measurableRaw === 'true' ? true : measurableRaw === 'false' ? false : undefined

  const parsed = curateSchema.safeParse({
    id: formData.get('id'),
    short_label: formData.get('short_label') || undefined,
    category: formData.get('category') || undefined,
    measurable,
    proof_requirement: formData.get('proof_requirement') || undefined,
    destination: formData.get('destination') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { id, ...patch } = parsed.data
  try {
    await curateEngagement(id, patch)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'curate failed' }
  }
  // path is the tender page; revalidate via the tender_id is more accurate but not strictly needed
  return { ok: true as const }
}

const rejectSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) })

export async function rejectEngagementsAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const idsRaw = formData.get('ids') as string | null
  if (!idsRaw) return { error: 'No ids provided' }
  const idsList = idsRaw.split(',').map((s) => s.trim()).filter(Boolean)

  const parsed = rejectSchema.safeParse({ ids: idsList })
  if (!parsed.success) return { error: 'Invalid ids' }

  try {
    await rejectEngagements(parsed.data.ids)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'reject failed' }
  }
  return { ok: true as const, count: parsed.data.ids.length }
}

const archiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(3).max(200),
})

export async function archiveEngagementAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = archiveSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const hasStarted = await hasLinkedInterventions(parsed.data.id)
  if (hasStarted) return { error: 'Des interventions sont liées — seul le label est modifiable' }

  try {
    await archiveEngagement(parsed.data.id, parsed.data.reason)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'archive failed' }
  }
  return { ok: true as const }
}

const createManualEngagementSchema = z.object({
  tender_id: z.string().uuid(),
  short_label: z.string().min(3).max(100),
  category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']),
})

export async function createEngagementManualAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createManualEngagementSchema.safeParse({
    tender_id: formData.get('tender_id'),
    short_label: formData.get('short_label'),
    category: formData.get('category'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    await createEngagementManual({
      tender_id: parsed.data.tender_id,
      contract_id: null,
      short_label: parsed.data.short_label,
      category: parsed.data.category,
      created_by: auth.userId,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'create failed' }
  }

  revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
  return { ok: true as const }
}

const createContractSchema = z.object({
  tender_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  client_name: z.string().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function createContractAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createContractSchema.safeParse({
    tender_id: formData.get('tender_id'),
    name: formData.get('name'),
    client_name: formData.get('client_name'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  let contractId: string
  try {
    contractId = await createContract({
      tender_id: parsed.data.tender_id,
      name: parsed.data.name,
      client_name: parsed.data.client_name,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      created_by: auth.userId,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'create contract failed' }
  }

  let activatedCount = 0
  try {
    activatedCount = await activateEngagementsForContract(parsed.data.tender_id, contractId)
  } catch (e) {
    // Contract is created but engagements not activated — return ID anyway
    console.error('[createContractAction] activation failed:', e)
  }

  return { ok: true as const, contractId, activatedCount }
}
