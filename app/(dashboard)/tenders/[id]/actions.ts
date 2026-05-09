'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { getUserRoleById } from '@/lib/db/users'
import { updateTenderStatus, softDeleteTender, getTender, getTenderDocument, countAnalysesToday } from '@/lib/db/tenders'

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

  // Fire-and-forget
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const secret = process.env.INTERNAL_ANALYZE_SECRET ?? ''
  fetch(`${baseUrl}/api/tenders/${parsed.data.id}/analyze`, {
    method: 'POST', headers: { 'x-internal-trigger': secret },
  }).catch(() => {})

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
