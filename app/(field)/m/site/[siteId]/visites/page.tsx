import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ChevronRight, Footprints } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteVisitsForMobile } from '@/lib/db/visits'
import { SiteTabs } from '../SiteTabs'
import { VisitLauncher } from '../VisitLauncher'

export const dynamic = 'force-dynamic'

/**
 * « Toutes les visites » d'un chantier — une seule question métier : montre-moi
 * toutes les visites de ce chantier. Liste chronologique déterministe (date,
 * auteur, nombre de photos, type). Chaque ligne ouvre le récap. Sous-écran de la
 * fiche chantier (la barre basse est masquée ici) → retour explicite en tête.
 */
export default async function SiteVisitsMobilePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const visits = await listSiteVisitsForMobile(siteId).catch(() => [])

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Visites</h1>
        <SiteTabs siteId={siteId} active="visites" userRole={user.role} />
      </header>

      {visits.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Aucune visite sur ce chantier pour l&apos;instant.</p>
          <div className="flex justify-center"><VisitLauncher siteId={siteId} activeVisit={null} /></div>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card divide-y">
          {visits.map((v) => {
            const meta = [
              v.authorName,
              v.photos > 0 ? `${v.photos} photo${v.photos > 1 ? 's' : ''}` : null,
              v.observations > 0 ? `${v.observations} observation${v.observations > 1 ? 's' : ''}` : null,
            ].filter(Boolean)
            return (
              <li key={v.id}>
                <Link href={v.href} className="flex items-start gap-3 px-3.5 py-3 active:bg-accent">
                  <Footprints className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-muted-foreground first-letter:uppercase">{v.dateLabel}</span>
                      {v.inProgress && (
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          En cours
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium">{v.objective ?? v.typeLabel}</span>
                    {meta.length > 0 && (
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{meta.join(' · ')}</span>
                    )}
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
