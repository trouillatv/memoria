import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export interface SiteQrInfo {
  id: string
  name: string
  address: string | null
  qr_token: string | null
  qr_generated_at: string | null
  qr_access_count: number
  qr_last_accessed_at: string | null
}

export async function getSiteQrInfo(siteId: string): Promise<SiteQrInfo | null> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('sites')
    .select('id, name, address, qr_token, qr_generated_at, qr_access_count, qr_last_accessed_at')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as SiteQrInfo | null
}

export async function getSiteByQrToken(token: string): Promise<{
  id: string
  name: string
  address: string | null
} | null> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('sites')
    .select('id, name, address')
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; name: string; address: string | null } | null
}

export async function generateQrToken(siteId: string): Promise<string> {
  const sb = createAdminClient()
  const { data: existing } = await sb
    .from('sites')
    .select('qr_token')
    .eq('id', siteId)
    .maybeSingle()
  if (existing?.qr_token) return existing.qr_token as string

  const token = randomBytes(18).toString('base64url')
  const { error } = await sb
    .from('sites')
    .update({ qr_token: token, qr_generated_at: new Date().toISOString() })
    .eq('id', siteId)
  if (error) throw error
  return token
}

export async function recordQrAccess(token: string): Promise<void> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('sites')
    .select('id, qr_access_count')
    .eq('qr_token', token)
    .maybeSingle()
  if (!data) return
  await sb
    .from('sites')
    .update({
      qr_access_count: ((data.qr_access_count as number) ?? 0) + 1,
      qr_last_accessed_at: new Date().toISOString(),
    })
    .eq('qr_token', token)
}
