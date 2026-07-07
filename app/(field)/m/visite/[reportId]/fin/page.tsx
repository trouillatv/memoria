import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, ArrowRight, FileText, Home } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit } from '@/lib/db/visits'

export const dynamic = 'force-dynamic'

/**
 * Le POINT FINAL de la visite. Écran dédié, très court : « C'est terminé, ta
 * mission est accomplie. » On sépare enfin la CLÔTURE (ici) de la CONSULTATION
 * (la récap /recap, devenue une fiche de visite archivée). Après « Retour au
 * chantier » / « Retour au dossier AO », la visite est réellement fermée.
 */
export default async function VisitFinPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  // AO ? (dossier en phase prospect/en_ao) — même règle que le débrief.
  const supabase = createAdminClient()
  let previsiteDossierId: string | null = null
  if (visit.dossier_id) {
    const { data: dossier } = await supabase.from('dossiers').select('phase').eq('id', visit.dossier_id).maybeSingle()
    const phase = (dossier as { phase: string } | null)?.phase
    if (phase === 'prospect' || phase === 'en_ao') previsiteDossierId = visit.dossier_id
  }
  const isAo = visit.visit_motive === 'previsite_ao' || !!previsiteDossierId
  const isPremiere = visit.visit_motive === 'premiere'
  const recapHref = `/m/visite/${reportId}/recap`

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-10 text-center">
      <div className="space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-semibold">
          {isAo ? 'Prévisite enregistrée' : isPremiere ? 'Première visite enregistrée' : 'Visite enregistrée'}
        </h1>
        {isAo ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Les informations sont maintenant disponibles dans le dossier d’appel d’offres.
            La préparation de la réponse se poursuit sur ordinateur.
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Votre visite est terminée. Elle a enrichi la mémoire du chantier.
          </p>
        )}
      </div>

      {/* Dans 90 % des cas, on veut juste repartir travailler : le retour est
          l'action PRINCIPALE. Mais consulter son travail ne doit pas sonner comme
          un « au revoir » — le CR est une VRAIE seconde option, chaleureuse et
          visible, pas un lien qu'on relègue. */}
      <div className="space-y-2.5">
        {isAo && previsiteDossierId ? (
          <Link
            href={`/dossiers/${previsiteDossierId}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
          >
            Retour au dossier AO <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href={`/m/site/${visit.site_id}?visite=ok`}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
          >
            <Home className="h-4 w-4" /> Retour au chantier
          </Link>
        )}
        <Link
          href={recapHref}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-800 active:brightness-95 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"
        >
          <FileText className="h-4 w-4" /> Revoir votre compte-rendu
        </Link>
        <p className="text-[13px] text-muted-foreground">
          Prenez le temps de le relire — il reste disponible à tout moment.
        </p>
      </div>
    </div>
  )
}
