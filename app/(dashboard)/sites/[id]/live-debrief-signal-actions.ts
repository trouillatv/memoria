'use server'

// D4 — wiring production pour « Vu » (signaux informationnels du LiveDebrief)
// dans « À savoir avant d'y aller ». Réplique le pattern de
// app/(dashboard)/dev/live-debrief/live-debrief-actions.ts (D3, non modifié)
// sans en dépendre : chaque surface a son propre point d'entrée serveur.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { createAdminClient } from '@/lib/supabase/admin'
import { markLiveDebriefSignalSeen, type LiveDebriefInformationalItem } from '@/lib/knowledge/live-debrief'

async function requireOperator(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  return { ok: true, userId: user.id }
}

async function siteBelongsToUserOrg(siteId: string): Promise<boolean> {
  const orgIds = await getOrgIdsOfUser()
  const admin = createAdminClient()
  const { data: site } = await admin.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  return !!site && orgIds.includes(site.organization_id as string)
}

export async function markLiveDebriefSignalSeenAction(
  item: LiveDebriefInformationalItem,
  siteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOperator()
  if (!auth.ok) return { ok: false, error: auth.error }
  if (!(await siteBelongsToUserOrg(siteId))) return { ok: false, error: 'Accès refusé' }
  await markLiveDebriefSignalSeen(item, siteId, auth.userId)
  return { ok: true }
}
