'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { updateTenderStatus, softDeleteTender, getTender, getTenderDocument, countAnalysesToday, insertTenderAnalysis } from '@/lib/db/tenders'
import { analyzeTender } from '@/services/ai/orchestrator'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const idSchema = z.object({ id: z.string().uuid() })

export async function relaunchAnalysisAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const tender = await getTender(parsed.data.id)
  if (!tender) return { error: 'AO introuvable' }

  const doc = await getTenderDocument(parsed.data.id)
  if (!doc || !doc.extracted_text) return { error: 'Pas de texte extrait — re-uploader le PDF' }

  const todayCount = await countAnalysesToday()
  const limit = parseInt(process.env.MAX_AO_ANALYSES_PER_DAY ?? '20', 10)
  if (todayCount >= limit) {
    return { error: `Quota journalier atteint (${todayCount}/${limit}).` }
  }

  await updateTenderStatus(parsed.data.id, 'analyzing', null)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'analysis_relaunched',
    metadata: {},
  })
  revalidatePath(`/tenders/${parsed.data.id}`)

  // Schedule background analyze via Next.js after()
  const tenderId = parsed.data.id
  const extractedText = doc.extracted_text
  after(async () => {
    try {
      const result = await analyzeTender(extractedText, userId)
      await insertTenderAnalysis({
        tender_id: tenderId,
        provider: result.provider as 'mock' | 'gemini' | 'anthropic' | 'openai',
        model: result.model,
        prompt_versions: result.promptVersions,
        summary: result.reading.summary,
        constraints: result.reading.constraints,
        risks: result.reading.risks,
        checklist: result.reading.checklist,
        technical_memo: result.memo.technical_memo,
        library_snapshot: result.librarySnapshot,
        raw_response: null,
      })
      await updateTenderStatus(tenderId, 'ready', null, result.score.score)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      console.error('[relaunchAnalysisAction] analyze failed:', e)
      await updateTenderStatus(tenderId, 'failed', msg)
    }
  })

  return { ok: true }
}

export async function archiveTenderAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  await softDeleteTender(parsed.data.id)
  await logAuditEvent({
    userId, entityType: 'tender', entityId: parsed.data.id,
    action: 'soft_deleted',
    metadata: {},
  })
  revalidatePath('/tenders')
  redirect('/tenders')
}
