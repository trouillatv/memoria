import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'

/**
 * Progression d'onboarding d'un nouveau tenant — CHANTIER-CENTRIC (Vincent 2026-06-21).
 * Avant : AO → engagements → contrat → missions (vision copilote AO).
 * Maintenant le produit démarre par le CHANTIER et sa mémoire :
 *   1. Créer un chantier (le lieu où la mémoire s'accumule)
 *   2. Démarrer une réunion (voix/notes → compte-rendu, actions, décisions)
 *   3. Suivre les actions (ce qui reste à faire / à confier aux entreprises)
 *
 * Le rideau tombe (welcome card disparaît) dès que la boucle est lancée
 * (chantier + réunion + action). Pas de "dismiss forever", pas de "skip".
 */
export interface OnboardingProgress {
  hasSite: boolean
  hasMeeting: boolean
  hasAction: boolean
  /** True quand la boucle chantier est amorcée. */
  allDone: boolean
}

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const supabase = createAdminClient()
  // M3 — AGRÉGATION multi-organisations. L'onboarding est ORGANISATIONNEL (la
  // boucle chantier est-elle amorcée ?), mais le dashboard est PERSONNEL : une
  // étape est acquise dès qu'elle est réalisée dans ≥1 organisation accessible.
  // Un compte AGP + SERVINOR n'est donc jamais bloqué parce que SERVINOR est
  // moins avancée. `.in([])` (aucune appartenance) ne matche rien → fail-closed.
  const orgIds = await getOrgIdsOfUser()

  // Chantiers des orgs (sert aussi à scoper les actions, qui n'ont pas d'org direct).
  const { data: siteRows, error: sitesErr } = await supabase
    .from('sites').select('id').is('deleted_at', null).in('organization_id', orgIds)
  if (sitesErr) throw sitesErr
  const siteIds = ((siteRows ?? []) as Array<{ id: string }>).map((s) => s.id)
  const hasSite = siteIds.length > 0

  const reportsRes = await supabase
    .from('site_reports').select('id', { count: 'exact', head: true }).in('organization_id', orgIds)
  if (reportsRes.error) throw reportsRes.error
  const hasMeeting = (reportsRes.count ?? 0) > 0

  let hasAction = false
  if (siteIds.length > 0) {
    const aRes = await supabase.from('site_actions').select('id', { count: 'exact', head: true }).in('site_id', siteIds)
    if (aRes.error) throw aRes.error
    hasAction = (aRes.count ?? 0) > 0
  }

  return {
    hasSite,
    hasMeeting,
    hasAction,
    allDone: hasSite && hasMeeting && hasAction,
  }
}
