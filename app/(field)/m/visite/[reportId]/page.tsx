import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit } from '@/lib/db/visits'
import { listVisitCaptures } from '@/lib/db/visit-captures'
import { DebriefExpress } from './DebriefExpress'

export const dynamic = 'force-dynamic'

/**
 * Débrief express d'une visite (temps 2 — la voiture). Écran TRÈS simple : on
 * relit vite ce qu'on a relevé et, pour chaque élément, on répond à une seule
 * question — « est-ce que ça mérite une suite ? » — via 4 choix métier. Le tri
 * enregistre la décision ; le bureau (débrief complet) matérialisera les suites.
 * Cf. [[visite-trois-temps]].
 */
export default async function VisitDebriefPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  // Scope org : une visite d'une autre organisation n'existe pas pour cet agent.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('name')
    .eq('id', visit.site_id)
    .maybeSingle()

  const captures = await listVisitCaptures(reportId)

  return (
    <DebriefExpress
      reportId={reportId}
      siteId={visit.site_id}
      siteName={(site as { name: string } | null)?.name ?? 'Chantier'}
      initialCaptures={captures}
    />
  )
}
