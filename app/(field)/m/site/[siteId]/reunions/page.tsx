import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ChevronRight, Users } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteMeetingsForMobile } from '@/lib/db/visits'
import { SiteTabs } from '../SiteTabs'
import { SiteReportLauncher } from '../SiteReportLauncher'

export const dynamic = 'force-dynamic'

/**
 * « Toutes les réunions » d'un chantier — question métier unique : montre-moi
 * toutes les réunions. Réunion / CR = site_report sans origin. Liste
 * chronologique ; chaque ligne ouvre le compte-rendu. Sous-écran de la fiche
 * chantier (barre basse masquée) → retour explicite en tête.
 */
export default async function SiteMeetingsMobilePage({
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

  const meetings = await listSiteMeetingsForMobile(siteId).catch(() => [])

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Réunions</h1>
        <SiteTabs siteId={siteId} active="reunions" userRole={user.role} />
      </header>

      {meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Aucune réunion sur ce chantier pour l&apos;instant.</p>
          <div className="flex justify-center">
            <SiteReportLauncher siteId={siteId} siteName={site.name} variant="mobile" label="Enregistrer une réunion" />
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link href={m.href} className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3.5 py-3 shadow-sm active:brightness-95">
                <Users className="h-5 w-5 shrink-0 text-sky-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                    <span className="first-letter:uppercase">{m.dateLabel}</span>
                    {m.authorName && <span>· {m.authorName}</span>}
                    {m.decisions > 0 && <span>· {m.decisions} décision{m.decisions > 1 ? 's' : ''}</span>}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
