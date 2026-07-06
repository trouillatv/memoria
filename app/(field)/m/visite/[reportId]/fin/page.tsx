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
            Votre visite est terminée. Elle a été ajoutée à l’historique du chantier et a enrichi sa mémoire.
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        {isAo && previsiteDossierId ? (
          <>
            <Link
              href={`/dossiers/${previsiteDossierId}`}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
            >
              Retour au dossier AO <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={recapHref}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-3 text-sm font-medium"
            >
              <FileText className="h-4 w-4" /> Voir le compte-rendu
            </Link>
          </>
        ) : (
          <>
            <Link
              href={recapHref}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
            >
              <FileText className="h-4 w-4" /> Voir le compte-rendu
            </Link>
            <Link
              href={`/m/site/${visit.site_id}`}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-3 text-sm font-medium"
            >
              <Home className="h-4 w-4" /> Retour au chantier
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
