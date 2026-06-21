// BRIEFING RÉUNION — page dédiée (Vincent 2026-06-21, choix A). « Le CR, elle l'ouvre
// APRÈS ; le briefing, AVANT. » Objet métier à part entière (pas un bloc perdu au
// milieu de la page réunion). Tient sur une page, imprimable. Alimenté par les
// DÉTECTEURS déterministes (site-memory-signals) — zéro IA.
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport } from '@/lib/db/site-reports'
import { buildSiteMemorySignals, buildSuggestedQuestions } from '@/lib/db/site-memory-signals'
import { listSiteSubjectsToWatch } from '@/lib/db/subjects'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrepareMeetingBlock } from '../PrepareMeetingBlock'
import { PrintButton } from './PrintButton'

export const dynamic = 'force-dynamic'

export default async function BriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { id } = await params
  const report = await getSiteReport(id)
  if (!report) notFound()

  const [signals, subjects, siteRow] = await Promise.all([
    report.site_id ? buildSiteMemorySignals(report.site_id) : Promise.resolve([]),
    report.site_id ? listSiteSubjectsToWatch(report.site_id) : Promise.resolve([]),
    report.site_id
      ? createAdminClient().from('sites').select('name').eq('id', report.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const questions = buildSuggestedQuestions(signals)
  const siteName = (siteRow?.data as { name?: string } | null)?.name ?? null
  const heading = report.title || (siteName ? `Réunion — ${siteName}` : 'Réunion')
  const dateLabel = new Date(report.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="w-full max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/meetings/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Réunion
        </Link>
        <PrintButton />
      </div>

      <header className="space-y-1 border-b pb-3">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5" /> Briefing réunion
        </p>
        <h1 className="text-2xl font-semibold capitalize">{heading}</h1>
        <p className="text-sm text-muted-foreground capitalize">{dateLabel}{siteName && !report.title ? '' : siteName ? ` · ${siteName}` : ''}</p>
      </header>

      {/* À surveiller — résumé en une ligne (titres des signaux actifs). */}
      {signals.length > 0 && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">À surveiller</h2>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {signals.map((s) => (
              <li key={s.kind} className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium">{s.title}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Sujets à surveiller (intelligence) + détail + Questions à poser. */}
      <PrepareMeetingBlock signals={signals} questions={questions} subjects={subjects} siteId={report.site_id ?? undefined} />

      <p className="text-[11px] text-muted-foreground/70 print:mt-6">
        Briefing déterministe (mémoire chantier) — généré le {dateLabel}. Le compte-rendu officiel se prépare après la réunion.
      </p>
    </div>
  )
}
