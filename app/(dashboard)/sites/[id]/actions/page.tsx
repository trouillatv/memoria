import { redirect, notFound } from 'next/navigation'
import { Info, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { readSiteActionSummaries, groupActionsByThread } from '@/lib/knowledge/repository'
import { getSitePendingActionProposals } from '@/lib/knowledge/site-pending-proposals'
import { getSiteActionsPilotage } from '@/lib/knowledge/actions-pilotage'
import { todayLocalIso } from '@/lib/time/local-date'
import { isActionOverdue } from '@/lib/knowledge/overdue-action'
import { SiteChantierNav } from '../SiteChantierNav'
import { ActionsPilotageClient } from '@/components/actions/ActionsPilotageClient'
import { PendingProposalsSection } from './PendingProposalsSection'

export const dynamic = 'force-dynamic'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// « En retard »/urgence : plus de définition locale. On converge sur le prédicat
// canonique partagé (overdue-action.ts), identique à l'Aperçu (P0.5). Une date
// dépassée non confirmée n'est pas « en retard » (→ 'late_unconfirmed').

export default async function SiteActionsHub({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, actionRows, pendingProposals] = await Promise.all([
    getSiteIdentity(id),
    readSiteActionSummaries(id),
    // #231 — population AGRÉGÉE des propositions d'action en attente (toutes visites).
    // C'est la destination du compteur « N proposées » de l'Aperçu.
    getSitePendingActionProposals(id).catch(() => []),
  ])
  if (!identity) notFound()

  const today = todayLocalIso()
  const weekEnd = addDays(today, 7)

  // KPI TEMPORELS (axe échéance) — sur les objets échéancés bruts. Repère temporel uniquement ;
  // ne déterminent PLUS la liste principale (désormais les sujets durables). V1-2.
  const rawOpen = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const groups = groupActionsByThread(rawOpen)
  const lateCount    = groups.filter((g) => isActionOverdue(g.representative.status, g.representative.due_date, g.representative.due_date_status, today)).length
  const todayCount   = groups.filter((g) => g.representative.due_date === today).length
  const weekCount    = groups.filter((g) => { const d = g.representative.due_date; return d && d > today && d <= weekEnd }).length
  const undatedCount = groups.filter((g) => !g.representative.due_date).length
  const hasUrgency   = lateCount > 0 || todayCount > 0 || weekCount > 0

  // V1-2 — LISTE PRINCIPALE = vérité durable SUJET → CBO → historique (getSiteActionsPilotage).
  const pilotage = await getSiteActionsPilotage(id)
  const k = pilotage.kpi

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="actions" label="Sujets à piloter" />
      {identity.clientName && (
        <BreadcrumbPrefix crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: '/sites', label: identity.clientName },
        ]} />
      )}

      {/* Navigation chantier PARTAGÉE (sticky compact) — identité persistante. */}
      <SiteChantierNav siteId={id} siteName={identity.name} clientName={identity.clientName} activeTab="actions" />

      <header className="space-y-3">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <ListTodo className="h-5 w-5" /> Sujets à piloter
        </h1>

        {/* KPI durable : sujets + objets métier (jamais « N actions ») + repère temporel. */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <span className="text-lg font-bold leading-none">{k.subjectsWithActions}</span> sujets
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
            <span className="text-lg font-bold leading-none">{k.activeCbo}</span> objets actifs
          </span>
          {k.completedCbo > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="text-lg font-bold leading-none">{k.completedCbo}</span> terminés
            </span>
          )}
          {k.toQualifyCbo > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
              <span className="text-lg font-bold leading-none">{k.toQualifyCbo}</span> à qualifier
            </span>
          )}
          {lateCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <span className="text-lg font-bold leading-none">{lateCount}</span> échéance{lateCount > 1 ? 's' : ''} en retard
            </span>
          )}
        </div>

        {/* Repère temporel secondaire (axe échéance), jamais la charge principale. */}
        {hasUrgency ? (
          <p className="text-xs text-muted-foreground">
            Échéances : {todayCount} aujourd&apos;hui · {weekCount} cette semaine · {undatedCount} sans date
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucune échéance urgente · {k.subjectsWithActions} sujet{k.subjectsWithActions > 1 ? 's' : ''} à piloter.
          </p>
        )}

        {/* Information documentaire SECONDAIRE, jamais une charge opérationnelle. */}
        {k.historicalFormulations > 0 && (
          <p className="text-xs text-muted-foreground">
            {k.historicalFormulations} formulation{k.historicalFormulations > 1 ? 's' : ''} documentaire{k.historicalFormulations > 1 ? 's' : ''} détectée{k.historicalFormulations > 1 ? 's' : ''} dans les PV · regroupée{k.historicalFormulations > 1 ? 's' : ''} en {k.totalCbo} objet{k.totalCbo > 1 ? 's' : ''} métier
          </p>
        )}
      </header>

      {/* Aide discrète */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Chaque sujet regroupe ses objets métier durables (à piloter) ; l&apos;historique documentaire
          (formulations issues des PV) reste consultable, replié, comme preuve.
        </span>
      </div>

      {/* ── PROPOSITIONS À CONFIRMER — axe distinct du lifecycle (« à confirmer », pas « à piloter »). */}
      <PendingProposalsSection proposals={pendingProposals} siteId={id} />

      {/* Liste principale — hiérarchie durable SUJET → CBO → historique. */}
      <ActionsPilotageClient subjects={pilotage.subjects} siteId={id} />
    </div>
  )
}
