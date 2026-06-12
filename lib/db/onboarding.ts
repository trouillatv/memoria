import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

/**
 * Progression d'onboarding d'un nouveau tenant.
 * Quatre étapes structurantes pour activer la boucle de preuve :
 *   1. Importer un AO
 *   2. Curer / valider les engagements extraits
 *   3. Convertir l'AO en contrat actif
 *   4. Planifier les missions (recettes opérationnelles)
 *
 * Le rideau tombe (la welcome card disparaît) dès qu'un contrat actif existe :
 * cf. doctrine — pas de "dismiss forever", pas de bouton "skip onboarding".
 */
export interface OnboardingProgress {
  hasImportedTender: boolean
  hasCuratedEngagement: boolean
  hasActiveContract: boolean
  hasMission: boolean
  /** True quand toutes les étapes sont franchies (boucle de preuve démarrée). */
  allDone: boolean
}

/**
 * 4 queries count exact en parallèle (head-only, pas de payload).
 * Coût ~marginal — appelée une seule fois sur /dashboard.
 */
export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  const tq = supabase.from('tenders').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  const eq = supabase.from('engagements').select('id', { count: 'exact', head: true }).eq('status', 'curated')
  const cq = supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('status', 'active').is('deleted_at', null)
  const mq = supabase.from('missions').select('id', { count: 'exact', head: true }).is('deleted_at', null)

  const [tendersRes, curatedRes, activeContractsRes, missionsRes] = await Promise.all([
    (orgId ? tq.eq('organization_id', orgId) : tq),
    (orgId ? eq.eq('organization_id', orgId) : eq),
    (orgId ? cq.eq('organization_id', orgId) : cq),
    (orgId ? mq.eq('organization_id', orgId) : mq),
  ])

  if (tendersRes.error) throw tendersRes.error
  if (curatedRes.error) throw curatedRes.error
  if (activeContractsRes.error) throw activeContractsRes.error
  if (missionsRes.error) throw missionsRes.error

  const hasImportedTender = (tendersRes.count ?? 0) > 0
  const hasCuratedEngagement = (curatedRes.count ?? 0) > 0
  const hasActiveContract = (activeContractsRes.count ?? 0) > 0
  const hasMission = (missionsRes.count ?? 0) > 0

  return {
    hasImportedTender,
    hasCuratedEngagement,
    hasActiveContract,
    hasMission,
    allDone: hasImportedTender && hasCuratedEngagement && hasActiveContract && hasMission,
  }
}
