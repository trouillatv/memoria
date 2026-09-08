import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadMemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { NeedsYouClient } from '@/app/(dashboard)/sites/[id]/besoin-de-toi/NeedsYouClient'

export const dynamic = 'force-dynamic'

// 6E.4A.10 — porte contextuelle depuis la fiche chantier mobile (mandat Vincent 2026-09-07) :
// même contenu métier et mêmes composants que /sites/[id]/besoin-de-toi (NeedsYouClient,
// NeedsYouCards, les 6 server actions du domaine), dans le shell /m — retour chantier, aucune
// bascule vers le shell desktop. Route indépendante, pas un 5e onglet ni une entrée du menu +.
export default async function FieldSiteBesoinDeToiPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)
  // Même restriction que la page desktop (managerOrAdmin) : ChefSiteView court-circuite déjà
  // la fiche chantier chef d'équipe avant que la pilule n'existe, donc personne ne clique
  // jamais ici en tant que chef_equipe. Repli défensif en cas d'accès direct par URL : retour
  // au chantier /m, jamais vers le shell desktop.
  if (user.role === 'chef_equipe') redirect(`/m/site/${siteId}`)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [summary, pointReadModel] = await Promise.all([
    loadMemoriaNeedsYouSummary(siteId),
    loadTrackedPointReadModel(siteId).catch(() => ({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] })),
  ])

  const sitePoints = pointReadModel.points
    .filter((p) => p.status === 'active')
    .map((p) => ({ id: p.id, label: p.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">🧠 MemorIA a besoin de toi</h1>
        <p className="text-sm text-muted-foreground">
          {summary.totalCount > 0
            ? `${summary.totalCount} question${summary.totalCount > 1 ? 's' : ''} à clarifier pour garder la mémoire du chantier fiable.`
            : 'Rien à clarifier pour le moment — la mémoire du chantier est à jour.'}
        </p>
      </header>

      <NeedsYouClient siteId={siteId} questions={summary.questions} categories={summary.categories} sitePoints={sitePoints} />
    </div>
  )
}
