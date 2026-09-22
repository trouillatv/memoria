import { redirect, notFound } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { getSiteCausalThreads } from '@/lib/knowledge/causal-threads'
import { buildSiteMemorySignals, type MemorySignal } from '@/lib/db/site-memory-signals'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { listTeams } from '@/lib/db/teams'
import type { DbTeam } from '@/types/db'
import { SiteChantierNav } from '../SiteChantierNav'
import { SiteMemoryQuery } from '../SiteMemoryQuery'
import { MemoireConfirmer } from '../views/memoire/MemoireConfirmer'

export const dynamic = 'force-dynamic'

// Simplification Mémoire (mandat Vincent 2026-09-22) : UNE page, deux blocs —
// « Interroger ce chantier » puis « Connaissances » (À valider → Connaissances
// validées). Le Hub à trois liens, les sous-onglets Récit/Pourquoi/À confirmer
// disparaissent : le cycle IA propose → je valide → ça entre dans la mémoire
// doit être visible d'un coup d'œil, pas dispersé entre trois onglets.
export default async function SiteMemoirePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const [review, threads, subjects, signals, teams] = await Promise.all([
    getMemoryReview(id).catch(() => ({ confirmed: [], toReview: [] })),
    getSiteCausalThreads(id).catch(() => null),
    listSubjectsBySite(id).catch(() => []),
    buildSiteMemorySignals(id).catch((): MemorySignal[] => []),
    listTeams().catch((): DbTeam[] => []),
  ])

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="memoire" label="Mémoire" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="memoire" />

      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-5 w-5" /> Mémoire</h1>
        <p className="text-sm text-muted-foreground">Ce que MemorIA sait du chantier, et ce qui reste à valider.</p>
      </header>

      <section className="rounded-xl border bg-card p-3.5 shadow-sm">
        <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Interroger ce chantier</p>
        <SiteMemoryQuery siteId={id} />
      </section>

      <MemoireConfirmer
        siteId={id}
        siteName={identity.name}
        review={review}
        signals={signals}
        subjectsCount={subjects.length}
        teams={teams}
        threads={threads ?? []}
      />
    </div>
  )
}
