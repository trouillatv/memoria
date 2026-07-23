'use server'

// Suppression de réunions (site_reports) — surtout les brouillons/échecs de test.
// Réservé admin/manager. Les actions/notes/interventions DÉJÀ matérialisées sont
// préservées (on détache seulement le lien report_id) — on ne supprime que le
// compte-rendu et ses sous-objets (pièces, propositions, liens sites).

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { requireSiteReportWriteAccess } from '@/lib/auth/site-write-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
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

/**
 * Supprimer une RÉUNION. Jamais une visite.
 *
 * `site_reports` porte DEUX objets : la réunion (`origin IS NULL`) et la visite
 * terrain (`origin` non nul). Et seize tables cascadent sur elle — dont
 * `visit_capture`, c'est-à-dire les PHOTOS et les VOCAUX du terrain.
 *
 * Le nettoyage en masse (plus bas) porte le garde `origin IS NULL`, et son
 * commentaire dit pourquoi : « les visites fuyaient ici et un clic aurait détruit
 * des captures ». Ce garde n'avait JAMAIS été reporté ici. La suppression
 * unitaire ne lisait même pas `origin` : seule la liste à l'écran empêchait le
 * drame. Une protection qui n'existe que dans l'interface n'est pas une
 * protection.
 *
 * Trois verrous désormais, fail-closed :
 *   1. ce doit être une réunion — sinon on refuse, en disant quoi faire ;
 *   2. aucune capture terrain ne doit y pendre — sinon on refuse plutôt que de
 *      détruire une preuve « au cas où » ;
 *   3. la suppression la plus destructive de l'application est TRACÉE.
 */
export async function deleteMeetingAction(
  reportId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!IdSchema.safeParse(reportId).success) return { ok: false, error: 'Réunion invalide' }

  // Frontière M2C : le CR appartient à l'org du chantier ; suppression réservée
  // au superviseur (managerOrAdmin), inchangée. L'org vient de la ressource.
  const access = await requireSiteReportWriteAccess(reportId, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: 'Réunion introuvable' }

  const supabase = createAdminClient()
  const { data: rep } = await supabase
    .from('site_reports')
    .select('id, origin, title')
    .eq('id', reportId)
    .maybeSingle()
  if (!rep) return { ok: false, error: 'Réunion introuvable' }

  const report = rep as {
    origin: string | null
    title: string | null
  }

  // VERROU 1 — ce n'est pas une réunion : c'est une visite terrain.
  if (report.origin !== null) {
    return {
      ok: false,
      error:
        "Ce n'est pas une réunion, c'est une visite terrain. La supprimer ici détruirait ses photos et ses vocaux. Passez par la visite elle-même.",
    }
  }

  // VERROU 2 — une réunion ne devrait porter aucune capture terrain. S'il y en a,
  // quelque chose ne va pas : on ne détruit pas une preuve « au cas où ».
  const { count: captureCount } = await supabase
    .from('visit_capture')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', reportId)
  if ((captureCount ?? 0) > 0) {
    return {
      ok: false,
      error: `Cette réunion porte ${captureCount} capture${(captureCount ?? 0) > 1 ? 's' : ''} terrain (photos, vocaux). La suppression est refusée : ces traces seraient détruites définitivement.`,
    }
  }

  try {
    await deleteReportRows(supabase, [reportId])
  } catch {
    return { ok: false, error: 'Échec de la suppression' }
  }

  // VERROU 3 — la suppression la plus destructive de l'application ne peut pas
  // rester muette.
  await logAuditEvent({
    userId: access.userId,
    entityType: 'report',
    entityId: reportId,
    action: 'removed',
    metadata: { kind: 'meeting', title: report.title, hard_delete: true },
  }).catch(() => {})

  revalidatePath('/meetings')
  return { ok: true }
}

/** Nettoyage en masse : supprime les brouillons + échecs de RÉUNIONS de
 *  l'organisation. Deux garde-fous :
 *  - JAMAIS les visites terrain (origin non-null) — elles fuyaient ici via
 *    l'écran Réunions et un clic aurait détruit des captures (photos, mémos) ;
 *  - JAMAIS les réunions des dernières 24 h : une réunion « en attente de son
 *    enregistrement » (créée dès ▶ Commencer) est en cours, pas un déchet. */
export async function cleanupDraftMeetingsAction(): Promise<
  { ok: true; deleted: number } | { ok: false; error: string }
> {
  const auth = await requireManager()
  if (!auth.ok) return auth

  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: true, deleted: 0 }
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('site_reports')
    .select('id')
    .in('status', ['draft', 'failed'])
    .is('origin', null)
    .lt('created_at', cutoff)
    .in('organization_id', orgIds)
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  try {
    await deleteReportRows(supabase, ids)
  } catch {
    return { ok: false, error: 'Échec du nettoyage' }
  }
  revalidatePath('/meetings')
  return { ok: true, deleted: ids.length }
}
