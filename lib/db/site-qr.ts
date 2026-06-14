import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QrEventType = 'generated' | 'scanned' | 'revoked'

export interface QrHistoryEvent {
  type: QrEventType
  at: string
  userAgent?: string | null
  tokenSuffix: string
}

export interface SiteAccessToken {
  id: string
  site_id: string
  token: string
  purpose: string
  created_by: string | null
  created_at: string
  last_accessed_at: string | null
  access_count: number
  revoked_at: string | null
  expires_at: string | null
}

export interface SiteQrInfo {
  id: string
  name: string
  address: string | null
  token: SiteAccessToken | null
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getSiteQrInfo(siteId: string): Promise<SiteQrInfo | null> {
  const sb = createAdminClient()

  const { data: site, error: siteErr } = await sb
    .from('sites')
    .select('id, name, address')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (siteErr) throw siteErr
  if (!site) return null

  const { data: token } = await sb
    .from('site_access_tokens')
    .select('*')
    .eq('site_id', siteId)
    .eq('purpose', 'journal_public')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    id: site.id as string,
    name: site.name as string,
    address: site.address as string | null,
    token: token as SiteAccessToken | null,
  }
}

/**
 * Résout un token public. Retourne null si :
 * - token inconnu
 * - token révoqué
 * - token expiré
 * - site supprimé
 */
export async function getSiteByQrToken(token: string): Promise<{
  id: string
  name: string
  address: string | null
  clientName: string | null
} | null> {
  const sb = createAdminClient()

  const { data: row, error } = await sb
    .from('site_access_tokens')
    .select('site_id, revoked_at, expires_at')
    .eq('token', token)
    .eq('purpose', 'journal_public')
    .maybeSingle()

  if (error || !row) return null

  // Vérifications de sécurité
  if (row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at as string) < new Date()) return null

  const { data: site } = await sb
    .from('sites')
    .select('id, name, address, clients(name)')
    .eq('id', row.site_id as string)
    .is('deleted_at', null)
    .maybeSingle()

  if (!site) return null

  const clientRow = (site as unknown as { clients?: { name: string } | null }).clients
  const clientName = clientRow?.name ?? null

  return {
    id: site.id as string,
    name: site.name as string,
    address: site.address as string | null,
    clientName,
  }
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Génère un token QR pour un site, ou retourne l'existant actif.
 */
export async function generateQrToken(siteId: string, createdBy?: string): Promise<string> {
  const sb = createAdminClient()

  // Réutiliser un token actif existant
  const { data: existing } = await sb
    .from('site_access_tokens')
    .select('token')
    .eq('site_id', siteId)
    .eq('purpose', 'journal_public')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) return existing.token as string

  const token = randomBytes(18).toString('base64url')
  const { error } = await sb.from('site_access_tokens').insert({
    site_id: siteId,
    token,
    purpose: 'journal_public',
    created_by: createdBy ?? null,
  })
  if (error) throw error
  return token
}

export async function recordQrAccess(token: string, userAgent?: string | null): Promise<void> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('site_access_tokens')
    .select('id, access_count')
    .eq('token', token)
    .maybeSingle()
  if (!data) return
  const now = new Date().toISOString()
  await Promise.all([
    sb
      .from('site_access_tokens')
      .update({
        access_count: ((data.access_count as number) ?? 0) + 1,
        last_accessed_at: now,
      })
      .eq('token', token),
    sb.from('qr_access_log').insert({
      token_id: data.id as string,
      scanned_at: now,
      user_agent: userAgent ? userAgent.slice(0, 300) : null,
    }),
  ])
}

export async function getSiteQrHistory(siteId: string): Promise<QrHistoryEvent[]> {
  const sb = createAdminClient()

  const { data: tokens } = await sb
    .from('site_access_tokens')
    .select('id, token, created_at, revoked_at')
    .eq('site_id', siteId)
    .eq('purpose', 'journal_public')
    .order('created_at', { ascending: true })

  if (!tokens || tokens.length === 0) return []

  const tokenIds = tokens.map((t) => t.id as string)

  const { data: scans } = await sb
    .from('qr_access_log')
    .select('token_id, scanned_at, user_agent')
    .in('token_id', tokenIds)
    .order('scanned_at', { ascending: false })
    .limit(200)

  const events: QrHistoryEvent[] = []

  for (const tok of tokens) {
    const suffix = (tok.token as string).slice(-6)
    events.push({ type: 'generated', at: tok.created_at as string, tokenSuffix: suffix })
    if (tok.revoked_at) {
      events.push({ type: 'revoked', at: tok.revoked_at as string, tokenSuffix: suffix })
    }
  }

  for (const scan of scans ?? []) {
    const tok = tokens.find((t) => t.id === scan.token_id)
    events.push({
      type: 'scanned',
      at: scan.scanned_at as string,
      userAgent: scan.user_agent as string | null,
      tokenSuffix: tok ? (tok.token as string).slice(-6) : '------',
    })
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return events.slice(0, 60)
}

export async function revokeQrToken(siteId: string): Promise<void> {
  const sb = createAdminClient()
  await sb
    .from('site_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('site_id', siteId)
    .eq('purpose', 'journal_public')
    .is('revoked_at', null)
}
