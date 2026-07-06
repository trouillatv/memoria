import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Footprints, Users, Wrench,
  ClipboardList, CheckCircle2, CheckSquare, Compass,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteTimeline, type TimelineKind } from '@/lib/db/site-timeline'
import { SiteTabs } from '../SiteTabs'
import { VisitLauncher } from '../VisitLauncher'

export const dynamic = 'force-dynamic'

/**
 * Frise du chantier — « Raconte-moi l'histoire de ce chantier ». Chronologie
 * plate, du plus récent au plus ancien, fusionnant tous les événements réels
 * (visites, réunions, interventions faites, réserves, actions terminées,
 * décisions). Déterministe, zéro IA. Chaque carte ouvre son objet quand une vue
 * mobile existe. Sous-écran de la fiche (barre basse masquée) → retour en tête.
 */
const META: Record<TimelineKind, { Icon: typeof Users; cls: string; ring: string }> = {
  visit: { Icon: Footprints, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  meeting: { Icon: Users, cls: 'text-sky-600', ring: 'bg-sky-100 dark:bg-sky-950/40' },
  intervention: { Icon: Wrench, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  reserve_open: { Icon: ClipboardList, cls: 'text-rose-600', ring: 'bg-rose-100 dark:bg-rose-950/40' },
  reserve_lifted: { Icon: CheckCircle2, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  action_done: { Icon: CheckSquare, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  decision: { Icon: Compass, cls: 'text-violet-600', ring: 'bg-violet-100 dark:bg-violet-950/40' },
}

export default async function SiteFriseMobilePage({
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

  const events = await buildSiteTimeline(siteId).catch(() => [])

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Frise du chantier</h1>
        <p className="text-sm text-muted-foreground">L&apos;histoire du chantier, du plus récent au plus ancien.</p>
        <SiteTabs siteId={siteId} active="frise" userRole={user.role} />
      </header>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Aucune activité pour l&apos;instant. Commencez à documenter ce chantier — visites, réunions et jalons apparaîtront ici.
          </p>
          <div className="flex justify-center"><VisitLauncher siteId={siteId} activeVisit={null} /></div>
        </div>
      ) : (
        <ol className="relative space-y-3 pl-2">
          {/* fil vertical de la frise */}
          <span aria-hidden className="absolute left-[22px] top-2 bottom-2 w-px bg-border" />
          {events.map((e, idx) => {
            // Garde-fou : un type inattendu ne doit jamais casser le rendu.
            const { Icon, cls, ring } = META[e.kind] ?? META.decision
            const body = (
              <>
                <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ring}`}>
                  <Icon className={`h-[18px] w-[18px] ${cls}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{e.title}</span>
                  {e.detail && <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{e.detail}</span>}
                  <span className="mt-0.5 block text-[12px] text-muted-foreground first-letter:uppercase">{e.dateLabel}</span>
                </span>
                {e.href && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />}
              </>
            )
            return (
              <li key={idx} className="relative">
                {e.href ? (
                  <Link href={e.href} className="flex items-start gap-3 rounded-xl border bg-card p-3 active:bg-accent">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border bg-card p-3">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
