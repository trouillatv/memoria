import { notFound } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit } from '@/lib/db/visits'
import { listVisitCaptures, getVisitCapturePreviewUrls } from '@/lib/db/visit-captures'
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

  // Le CTA « Préparer l'AO » n'a de sens que pour une VRAIE prévisite d'appel
  // d'offres (dossier en phase prospect/en_ao). Une visite normale sur un
  // chantier actif porte aussi un dossier (phase 'actif') mais ne doit PAS
  // proposer de démarrer un AO — à ce moment l'agent pense « qu'est-ce que je
  // fais de ma visite ? », pas « je lance un appel d'offres ».
  let previsiteDossierId: string | null = null
  if (visit.dossier_id) {
    const { data: dossier } = await supabase
      .from('dossiers')
      .select('phase')
      .eq('id', visit.dossier_id)
      .maybeSingle()
    const phase = (dossier as { phase: string } | null)?.phase
    if (phase === 'prospect' || phase === 'en_ao') previsiteDossierId = visit.dossier_id
  }

  const [{ count: questionsCount }, previews] = await Promise.all([
    // ❓ « à vérifier » posées pendant la visite (captured_knowledge) — comptées
    // pour le récap de fin, à côté des captures.
    supabase
      .from('captured_knowledge')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', reportId)
      .eq('kind', 'question')
      .eq('status', 'active'),
    // Aperçus (miniature/lecteur) pour trier en VOYANT le contenu.
    getVisitCapturePreviewUrls(captures).catch(() => ({})),
  ])

  return (
    <DebriefExpress
      reportId={reportId}
      siteId={visit.site_id}
      siteName={(site as { name: string } | null)?.name ?? 'Chantier'}
      dossierId={previsiteDossierId}
      questionsCount={questionsCount ?? 0}
      initialCaptures={captures}
      previews={previews}
    />
  )
}
