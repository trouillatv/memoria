'use server'

// Suppression de réunions (site_reports) — surtout les brouillons/échecs de test.
// Réservé admin/manager. Les actions/notes/interventions DÉJÀ matérialisées sont
// préservées (on détache seulement le lien report_id) — on ne supprime que le
// compte-rendu et ses sous-objets (pièces, propositions, liens sites).

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const IdSchema = z.string().uuid()

async function requireManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  return { ok: true }
}

async function deleteReportRows(supabase: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // Préserver les actions matérialisées : on retire juste l'origine.
  await supabase.from('site_actions').update({ report_id: null }).in('report_id', ids)
  await supabase.from('report_sites').delete().in('report_id', ids)
  await supabase.from('site_report_proposals').delete().in('report_id', ids)
  await supabase.from('site_report_attachments').delete().in('report_id', ids)
  const { error } = await supabase.from('site_reports').delete().in('id', ids)
  if (error) throw error
}

export async function deleteMeetingAction(
  reportId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!IdSchema.safeParse(reportId).success) return { ok: false, error: 'Réunion invalide' }
  const auth = await requireManager()
  if (!auth.ok) return auth

  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const { data: rep } = await supabase
    .from('site_reports')
    .select('id, organization_id')
    .eq('id', reportId)
    .maybeSingle()
  if (!rep) return { ok: false, error: 'Réunion introuvable' }
  if (orgId && (rep as { organization_id: string | null }).organization_id && (rep as { organization_id: string | null }).organization_id !== orgId) {
    return { ok: false, error: 'Accès refusé' }
  }
  try {
    await deleteReportRows(supabase, [reportId])
  } catch {
    return { ok: false, error: 'Échec de la suppression' }
  }
  revalidatePath('/meetings')
  return { ok: true }
}

/** Nettoyage en masse : supprime tous les brouillons + échecs de l'organisation. */
export async function cleanupDraftMeetingsAction(): Promise<
  { ok: true; deleted: number } | { ok: false; error: string }
> {
  const auth = await requireManager()
  if (!auth.ok) return auth

  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('site_reports').select('id').in('status', ['draft', 'failed'])
  if (orgId) q = q.eq('organization_id', orgId)
  const { data } = await q
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  try {
    await deleteReportRows(supabase, ids)
  } catch {
    return { ok: false, error: 'Échec du nettoyage' }
  }
  revalidatePath('/meetings')
  return { ok: true, deleted: ids.length }
}
