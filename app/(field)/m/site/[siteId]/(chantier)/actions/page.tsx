import { ListTodo } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { getSiteActionsPilotage } from '@/lib/knowledge/actions-pilotage'
import { ActionsPilotageClient } from '@/components/actions/ActionsPilotageClient'

export const dynamic = 'force-dynamic'

// V1-2 — Pill « Actions » du chantier : MÊME vérité durable que le desktop (getSiteActionsPilotage),
// hiérarchie SUJET → CBO → historique via le composant partagé. Plus aucune liste principale issue
// de listOpenSiteActions (site_actions brut). La garde d'appartenance reste ICI (doctrine).
export default async function SiteActionsPillPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  await requireSiteAccess(siteId)
  const pilotage = await getSiteActionsPilotage(siteId)
  const k = pilotage.kpi

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
      <ActionsPilotageClient subjects={pilotage.subjects} siteId={siteId} />
    </div>
  )
}
