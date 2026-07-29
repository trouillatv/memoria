'use server'

import { after } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'

export async function analyzePvAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const documentId = formData.get('document_id')?.toString()
  if (!documentId) return { ok: false, error: 'document_id manquant' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }

  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') {
    return { ok: false, error: 'Permissions insuffisantes' }
  }

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!doc || (doc as { document_type: string }).document_type !== 'historical_visit_report') {
    return { ok: false, error: 'Ce document ne peut pas être analysé comme PV historique' }
  }

  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false, error: 'CRON_SECRET non configuré' }

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const extractionUrl = `${proto}://${host}/api/extraction/historical-pv`

  after(async () => {
    try {
      await fetch(extractionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-trigger': secret },
        body: JSON.stringify({ documentId, userId: user.id }),
      })
    } catch (e) {
      console.error('analyzePvAction trigger error:', e)
    }
  })

  return { ok: true }
}
