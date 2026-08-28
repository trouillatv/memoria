import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Info, ListTodo, Sparkles } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { readSiteActionSummaries, groupActionsByThread, readReportMeta, classifyProvenance } from '@/lib/knowledge/repository'
import { getSitePendingActionProposals } from '@/lib/knowledge/site-pending-proposals'
import { todayLocalIso } from '@/lib/time/local-date'
import { classifyActionUrgency, isActionOverdue } from '@/lib/knowledge/overdue-action'
import { SiteChantierNav } from '../SiteChantierNav'
import { ActionsListClient, type ActionGroupDisplay } from './ActionsListClient'

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

  // Groupes dédupliqués (représentant + compteur + PV sources)
  const rawOpen = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const groups = groupActionsByThread(rawOpen)
    .sort((a, b) => (a.representative.due_date ?? '9999').localeCompare(b.representative.due_date ?? '9999'))

  // Métadonnées des rapports sources (type + has_doc + date)
  const allReportIds = [...new Set(groups.flatMap((g) => g.reportIds))]
  const reportMeta = await readReportMeta(allReportIds)

  // KPI counts
  const lateCount    = groups.filter((g) => isActionOverdue(g.representative.status, g.representative.due_date, g.representative.due_date_status, today)).length
  const todayCount   = groups.filter((g) => g.representative.due_date === today).length
  const weekCount    = groups.filter((g) => {
    const d = g.representative.due_date
    return d && d > today && d <= weekEnd
  }).length
  const undatedCount = groups.filter((g) => !g.representative.due_date).length

  // Distribution des provenances (par groupe dédupliqué, pas par occurrence DB)
  const provDist = { pv_historique: 0, visite: 0, reunion: 0, manuel: 0, autre: 0 }
  for (const g of groups) {
    const mainReportId = g.reportIds[0] ?? null
    const prov = classifyProvenance(mainReportId ? reportMeta.get(mainReportId) : undefined, Boolean(mainReportId))
    provDist[prov]++
  }
  const docCount = allReportIds.length
  // Plage dates
  const metaDates = allReportIds
    .map((rid) => reportMeta.get(rid)?.started_at ?? null)
    .filter((d): d is string => Boolean(d))
    .sort()
  const dateRange = metaDates.length >= 2
    ? `${new Date(metaDates[0]).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })} → ${new Date(metaDates[metaDates.length - 1]).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`
    : metaDates.length === 1
    ? new Date(metaDates[0]).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null

  // Groupes normalisés pour le composant client (uniquement JSON-serializable)
  const PROV_LABEL: Record<string, string> = {
    pv_historique: 'PV historique', visite: 'Visite', reunion: 'Réunion', manuel: 'Manuel', autre: 'Rapport',
  }
  const displayGroups: ActionGroupDisplay[] = groups.map((g) => {
    const rep = g.representative
    const mainReportId = g.reportIds[0] ?? null
    const meta = mainReportId ? reportMeta.get(mainReportId) : undefined
    const prov = classifyProvenance(meta, Boolean(mainReportId))
    const provenanceDate = meta?.started_at
      ? new Date(meta.started_at).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
      : null
    return {
      id: rep.id,
      title: rep.title,
      count: g.count,
      docCount: g.reportIds.length,
      provenanceLabel: PROV_LABEL[prov] ?? 'Rapport',
      provenanceDate,
      due_date: rep.due_date,
      assignedTo: rep.assigned_to ?? null,
      corpsEtat: rep.corps_etat ?? null,
      urgency: classifyActionUrgency(rep.due_date, rep.due_date_status, today),
      actionHref: `/sites/${id}/action/${rep.id}`,
      // Mémoire longitudinale du sujet, quand le lien existe DÉJÀ en base (mig 346).
      // Aucun rapprochement n'est calculé ici : pas de FK, pas de lien.
      subjectHref: g.canonicalSubjectId
        ? `/sites/${id}/historique/sujets/${g.canonicalSubjectId}`
        : null,
    }
  })

  const hasUrgency = lateCount > 0 || todayCount > 0 || weekCount > 0
  const totalGroups = groups.length

  // Ligne de distribution lisible
  const provLines: string[] = []
  if (provDist.pv_historique > 0) provLines.push(`${provDist.pv_historique} PV historique${provDist.pv_historique > 1 ? 's' : ''}`)
  if (provDist.visite > 0) provLines.push(`${provDist.visite} visite${provDist.visite > 1 ? 's' : ''}`)
  if (provDist.reunion > 0) provLines.push(`${provDist.reunion} réunion${provDist.reunion > 1 ? 's' : ''}`)
  if (provDist.manuel > 0) provLines.push(`${provDist.manuel} manuelle${provDist.manuel > 1 ? 's' : ''}`)
  if (provDist.autre > 0) provLines.push(`${provDist.autre} autre${provDist.autre > 1 ? 's' : ''}`)

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <DynamicCrumb segmentId={id} label={identity.name} />
      <DynamicCrumb segmentId="actions" label="Sujets d'action" />
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
          <ListTodo className="h-5 w-5" /> Sujets d&apos;action
        </h1>

        {/* 4 KPI chips */}
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${lateCount > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{lateCount}</span> en retard
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${todayCount > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{todayCount}</span> aujourd&apos;hui
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${weekCount > 0 ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
            <span className="text-lg font-bold leading-none">{weekCount}</span> cette semaine
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
            <span className="text-lg font-bold leading-none">{undatedCount}</span> à planifier
          </span>
        </div>

        {/* Message rassurant si aucune urgence */}
        {!hasUrgency && totalGroups > 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune urgence aujourd&apos;hui · {totalGroups} sujet{totalGroups > 1 ? 's' : ''} à organiser.
          </p>
        )}
      </header>

      {/* Provenance — distribution réelle */}
      {provLines.length > 0 && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 space-y-0.5">
          <p className="text-sm font-medium">Origine des sujets</p>
          <p className="text-sm text-muted-foreground">{provLines.join(' · ')}</p>
          {docCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {docCount} document{docCount > 1 ? 's' : ''} source{docCount > 1 ? 's' : ''}
              {dateRange && ` · ${dateRange}`}
            </p>
          )}
        </div>
      )}

      {/* Aide discrète */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          MemorIA regroupe les demandes répétées portant sur le même sujet.
          Une ligne représente un sujet à organiser ou traiter, même s&apos;il a été mentionné plusieurs fois dans des documents différents.
        </span>
      </div>

      {/* ── PROPOSITIONS À CONFIRMER (#231) ───────────────────────────────────
          Destination du compteur « N proposées » de l'Aperçu : la population
          AGRÉGÉE du chantier, toutes visites/imports confondus. Chaque ligne
          renvoie à la page de SON report pour l'arbitrage. « IA propose, humain
          confirme » — distinct des sujets d'action déjà validés ci-dessous. */}
      {pendingProposals.length > 0 && (
        <section id="propositions" className="scroll-mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/20">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-600" aria-hidden />
            <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
              {pendingProposals.length} proposition{pendingProposals.length > 1 ? 's' : ''} à confirmer
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Détectées par MemorIA, en attente de votre décision. Ouvrez la visite d&apos;origine pour arbitrer.
          </p>
          <ul className="mt-3 divide-y">
            {pendingProposals.map((p) => {
              const meta = [p.provenanceLabel, p.provenanceDate].filter(Boolean).join(' · ')
              const inner = (
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground/90">{p.title}</span>
                    {meta && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{meta}</span>}
                  </span>
                  {p.reportHref && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                </span>
              )
              return (
                <li key={p.id} className="py-2">
                  {p.reportHref ? (
                    <Link href={p.reportHref} className="block rounded-lg px-1 -mx-1 hover:bg-muted/50">{inner}</Link>
                  ) : (
                    <div className="px-1">{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Liste interactive */}
      {groups.length > 0 ? (
        <ActionsListClient groups={displayGroups} siteId={id} />
      ) : (
        <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun sujet d&apos;action ouvert sur ce chantier.
        </p>
      )}
    </div>
  )
}
