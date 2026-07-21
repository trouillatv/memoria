import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Gavel, Monitor, History } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listDecisionsByReport } from '@/lib/db/site-decisions'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import type { DbSiteReport } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * Récap d'une RÉUNION sur mobile. Une réunion est un `site_report` à `origin`
 * nul — elle n'a donc rien à faire sur la récap de VISITE (qui filtre les
 * visites terrain). Le téléphone donne l'essentiel (date, auteur, décisions
 * prises) ; le détail complet (PV, transcription) s'exploite sur ordinateur.
 * Lecture seule, déterministe, zéro donnée inventée.
 */
export default async function MeetingRecapPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_reports')
    .select('*')
    .eq('id', reportId)
    .is('origin', null)
    .maybeSingle()
  const report = (data as DbSiteReport | null) ?? null
  if (!report || !report.site_id) notFound()
  if (report.organization_id && user.organization_id && report.organization_id !== user.organization_id) {
    notFound()
  }

  const [{ data: site }, { data: author }, decisions] = await Promise.all([
    supabase.from('sites').select('name').eq('id', report.site_id).maybeSingle(),
    report.created_by
      ? supabase.from('users').select('full_name').eq('id', report.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    listDecisionsByReport(reportId).catch(() => []),
  ])
  const siteName = (site as { name: string } | null)?.name ?? 'Chantier'
  const authorName = (author as { full_name: string | null } | null)?.full_name?.trim() || null

  const startIso = report.started_at ?? report.created_at
  // Fuseau du chantier, pas du serveur : Vercel tourne en UTC et daterait la
  // réunion de la veille (et l'heure de 11 h de trop).
  const dateLabel = new Date(startIso).toLocaleString('fr-FR', {
    timeZone: NOUMEA_TZ,
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-4 px-4 pb-16 pt-5">
      <Link href={`/m/site/${report.site_id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Chantier
      </Link>

      <header className="space-y-0.5">
        <p className="text-xs font-medium uppercase tracking-wide text-sky-700">Compte-rendu de réunion</p>
        <h1 className="text-xl font-semibold">{report.title?.trim() || 'Réunion'}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {siteName} · {dateLabel}
          {authorName && ` · ${authorName}`}
        </p>
      </header>

      {/* Décisions prises — le cœur d'une réunion. Masqué s'il n'y en a pas. */}
      {decisions.length > 0 && (
        <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-950/40">
              <Gavel className="h-[18px] w-[18px] text-violet-600" />
            </span>
            <h2 className="text-sm font-semibold">
              {decisions.length > 1 ? `Décisions prises (${decisions.length})` : 'Décision prise'}
            </h2>
          </div>
          <ul className="space-y-1.5">
            {decisions.map((d) => (
              <li key={d.id} className="flex gap-2 text-[13px] leading-snug text-foreground/90">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-violet-500" />
                <span className="min-w-0">
                  {d.titre}
                  {d.decisionnaireRole && <span className="text-muted-foreground"> — {d.decisionnaireRole}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Le détail complet (PV, transcription) s'exploite sur ordinateur. */}
      <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800/60">
            <Monitor className="h-[18px] w-[18px] text-slate-600" />
          </span>
          <h2 className="text-sm font-semibold">Détail complet sur ordinateur</h2>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Le compte-rendu détaillé de la réunion (PV, transcription, participants) se consulte au bureau.
        </p>
        <code className="mt-2 block truncate rounded-lg border bg-muted/40 px-2.5 py-1.5 text-[12px] text-muted-foreground">
          /meetings/{report.id}
        </code>
      </section>

      {/* Conclusion — cohérente avec la grammaire des récaps. */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="flex items-center gap-2.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
            <History className="h-[18px] w-[18px] text-emerald-600" />
          </span>
          <span className="min-w-0">Cette réunion fait partie de l’histoire du chantier.</span>
        </p>
      </div>
    </div>
  )
}
