// Couche « Nouveau depuis hier » (Vincent 2026-06-22) — ce qui s'est passé depuis
// la dernière consultation : déclarations QR des entreprises (Fait/Bloqué) + photos
// reçues. FILTRE pas FEED : on montre ce qui mérite un regard, pas l'activité brute.
// Déterministe, zéro IA. Une primitive : last_seen_at par utilisateur (mig 157).

import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000 // 1er passage : 24 h en arrière

export interface InboxItem {
  actionId: string
  company: string         // recipient_label (« COLAS »), jamais un salarié
  actionTitle: string
  site: string
  siteId: string
  status: 'done' | 'blocked'
  comment: string | null
  hasPhoto: boolean
  declaredAt: string
}

export interface InboxFeed {
  since: string
  items: InboxItem[]
  doneCount: number
  blockedCount: number
  photoCount: number
}

export async function getLastSeen(userId: string): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('user_feed_state').select('last_seen_at').eq('user_id', userId).maybeSingle()
  return (data?.last_seen_at as string | null) ?? null
}

export async function getInboxFeed(userId: string, orgId: string | null): Promise<InboxFeed> {
  const since = (await getLastSeen(userId)) ?? new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString()
  const empty: InboxFeed = { since, items: [], doneCount: 0, blockedCount: 0, photoCount: 0 }
  if (!orgId) return empty

  const sb = createAdminClient()
  // 1) déclarations fraîches (Fait/Bloqué) depuis `since`
  const { data: rawItems } = await sb
    .from('action_distribution_items')
    .select('action_id, distribution_id, declared_status, declared_comment, declared_photo_path, declared_at')
    .gte('declared_at', since)
    .in('declared_status', ['done', 'blocked'])
    .order('declared_at', { ascending: false })
    .limit(60)
  const rows = (rawItems ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return empty

  // 2) contexte (entreprise + site, scopé org) et 3) libellé d'action — en lot
  const distIds = [...new Set(rows.map((r) => r.distribution_id as string))]
  const actionIds = [...new Set(rows.map((r) => r.action_id as string))]
  const [{ data: dists }, { data: actions }] = await Promise.all([
    sb.from('action_distributions').select('id, recipient_label, site_id').in('id', distIds),
    sb.from('site_actions').select('id, title').in('id', actionIds),
  ])
  const siteIds = [...new Set((dists ?? []).map((d) => d.site_id as string))]
  const { data: sites } = await sb.from('sites').select('id, name, organization_id').in('id', siteIds)

  const siteById = new Map((sites ?? []).map((s) => [s.id as string, s]))
  const distById = new Map((dists ?? []).map((d) => [d.id as string, d]))
  const actionTitle = new Map((actions ?? []).map((a) => [a.id as string, a.title as string]))

  const items: InboxItem[] = []
  for (const r of rows) {
    const dist = distById.get(r.distribution_id as string)
    if (!dist) continue
    const site = siteById.get(dist.site_id as string)
    if (!site || site.organization_id !== orgId) continue // RLS-like : org only
    items.push({
      actionId: r.action_id as string,
      company: (dist.recipient_label as string) ?? 'Entreprise',
      actionTitle: actionTitle.get(r.action_id as string) ?? 'Action',
      site: site.name as string,
      siteId: dist.site_id as string,
      status: r.declared_status as 'done' | 'blocked',
      comment: (r.declared_comment as string | null) ?? null,
      hasPhoto: !!r.declared_photo_path,
      declaredAt: r.declared_at as string,
    })
  }

  return {
    since,
    items,
    doneCount: items.filter((i) => i.status === 'done').length,
    blockedCount: items.filter((i) => i.status === 'blocked').length,
    photoCount: items.filter((i) => i.hasPhoto).length,
  }
}

/** « Tout marquer comme vu » → last_seen_at := now(). */
export async function markInboxSeen(userId: string): Promise<void> {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  await sb.from('user_feed_state').upsert({ user_id: userId, last_seen_at: now, updated_at: now }, { onConflict: 'user_id' })
}
