'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { runEngagementExtractionAgent } from '@/services/ai/engagement-extraction'
import { bulkInsertEngagements, listEngagementsByTender } from '@/lib/db/engagements'
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
  if (existing.length > 0) return { error: 'Engagements déjà extraits pour cet AO' }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'AO introuvable' }

  const [doc, analysis] = await Promise.all([
    getTenderDocument(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
  ])
  if (!doc?.extracted_text) return { error: 'Pas de texte extrait sur le document AO' }

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
