import { ListTodo } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteActionsPilotage } from '@/lib/knowledge/actions-pilotage'
import { getSiteReservesPilotage } from '@/lib/knowledge/reserves-pilotage'
import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import { listSiteActionResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'
import { listSiteCandidateCompanies } from '@/lib/db/site-intervenants'
import { ActionsPilotageClient } from '@/components/actions/ActionsPilotageClient'

export const dynamic = 'force-dynamic'

// V1-2 — Pill « Actions » du chantier : MÊME vérité durable que le desktop (getSiteActionsPilotage),
// hiérarchie SUJET → CBO → historique via le composant partagé. Plus aucune liste principale issue
// de listOpenSiteActions (site_actions brut). La garde d'appartenance reste ICI (doctrine).
export default async function SiteActionsPillPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  await requireSiteAccess(siteId)
  const [pilotage, reservesPilotage, deadlines, responsibleCandidates, companies] = await Promise.all([
    getSiteActionsPilotage(siteId),
    // Lot 3 composition unifiée (Vincent 2026-09-15) — mêmes read-models que desktop.
    getSiteReservesPilotage(siteId),
    listSiteDeadlines(siteId),
    // Lot normalisation 3 points d'entrée (Vincent 2026-09-15) — même panneau d'affectation
    // partagé que desktop/Point.
    listSiteActionResponsibleCandidates(siteId).catch(() => []),
    listSiteCandidateCompanies(siteId).catch(() => []),
  ])
  const k = pilotage.kpi
  const reserveCountBySubject: Record<string, number> = {}
  for (const rs of reservesPilotage.subjects) reserveCountBySubject[rs.canonicalSubjectId] = rs.reserves.length
  const deadlineCountBySubject: Record<string, number> = {}
  for (const d of deadlines) {
    if (!d.canonical_subject_id) continue
    deadlineCountBySubject[d.canonical_subject_id] = (deadlineCountBySubject[d.canonical_subject_id] ?? 0) + 1
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-2">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          Sujets à piloter
        </h1>
        <p className="text-sm text-muted-foreground">
          {k.subjectsWithActions} sujet{k.subjectsWithActions > 1 ? 's' : ''} · {k.activeCbo} objet{k.activeCbo > 1 ? 's' : ''} actif{k.activeCbo > 1 ? 's' : ''}
          {k.completedCbo > 0 && ` · ${k.completedCbo} terminé${k.completedCbo > 1 ? 's' : ''}`}
          {k.toQualifyCbo > 0 && ` · ${k.toQualifyCbo} à qualifier`}
        </p>
        {k.historicalFormulations > 0 && (
          <p className="text-xs text-muted-foreground">
            {k.historicalFormulations} formulation{k.historicalFormulations > 1 ? 's' : ''} documentaire{k.historicalFormulations > 1 ? 's' : ''} dans les PV
          </p>
        )}
      </header>
      <ActionsPilotageClient subjects={pilotage.subjects} siteId={siteId}
        responsibleCandidates={responsibleCandidates} companies={companies}
        reserveCountBySubject={reserveCountBySubject} deadlineCountBySubject={deadlineCountBySubject} />
    </div>
  )
}
