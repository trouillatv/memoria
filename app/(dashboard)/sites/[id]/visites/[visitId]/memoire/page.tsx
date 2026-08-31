import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile, userBelongsToOrg } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { listProposalsByReport, getCanonicalSubjectLabels } from '@/lib/db/knowledge-proposals'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { FactLedgerView } from './FactLedgerView'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set(['proposed', 'confirmed', 'fulfilled'])

export default async function VisitMemoirePage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit, proposals] = await Promise.all([
    getSiteIdentity(id),
    getVisit(visitId),
    listProposalsByReport(visitId),
  ])
  if (!identity || !visit || visit.site_id !== id) notFound()
  if (visit.organization_id && !(await userBelongsToOrg(user.id, visit.organization_id))) {
    notFound()
  }

  const active = proposals.filter((p) => ACTIVE_STATUSES.has(p.status))
  const archived = proposals.filter((p) => !ACTIVE_STATUSES.has(p.status))

  const canonicalIds = [...new Set(proposals.map((p) => p.canonical_subject_id).filter((id): id is string => !!id))]
  const subjectLabelMap = await getCanonicalSubjectLabels(canonicalIds)
  const subjectLabels = Object.fromEntries(subjectLabelMap)

  const debut = visit.started_at ?? visit.created_at
  const visitLabel = visit.origin === 'import' && visit.text_input
    ? visit.text_input
    : `Visite du ${new Date(debut).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })}`

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav aria-label="Fil d'Ariane" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href="/sites" className="hover:text-foreground">Chantiers</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}/visites`} className="hover:text-foreground">Visites</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}/visites/${visitId}`} className="hover:text-foreground">{visitLabel}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium text-foreground">Historique des propositions</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Historique des propositions</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Le journal d&apos;audit des propositions de cette visite : anciennes (remplacées) et écartées.
          Les propositions actives se consultent et se traitent depuis la visite et leur espace métier.
        </p>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {archived.length} proposition{archived.length > 1 ? 's' : ''} archivée{archived.length > 1 ? 's' : ''}
        </p>
      </header>

      {proposals.length === 0 ? (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">Aucun élément extrait pour cette visite.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            L&apos;analyse MemorIA n&apos;a pas encore été lancée, ou n&apos;a rien produit.
          </p>
        </section>
      ) : (
        <FactLedgerView
          active={active}
          archived={archived}
          subjectLabels={subjectLabels}
          siteId={id}
        />
      )}
    </div>
  )
}
