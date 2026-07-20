import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Mic, MapPin, Building2, ListTodo, AlertTriangle, FileText, Network } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listMeetings, type MeetingListRow } from '@/lib/db/site-reports'
import { listOpenSiteActionsByReports, type SiteActionRow } from '@/lib/db/site-actions'
import { listContracts } from '@/lib/db/contracts'
import { listSites } from '@/lib/db/sites'
import { EmptyState } from '@/components/ui/empty-state'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import { NewMeetingButton } from './NewMeetingButton'
import { SiteBriefButton } from '@/app/(dashboard)/sites/[id]/SiteBriefButton'
import { DeleteMeetingButton, CleanupDraftMeetingsButton } from './MeetingActions'
import type { SiteReportStatus } from '@/types/db'

function meetingHeading(m: MeetingListRow): string {
  if (m.title) return m.title
  return m.type === 'contract'
    ? `Réunion contrat${m.contractName ? ` — ${m.contractName}` : ''}`
    : `Réunion site${m.siteNames[0] ? ` — ${m.siteNames[0]}` : ''}`
}

export const dynamic = 'force-dynamic'

// Statut métier affiché (3 niveaux lisibles, pas l'état machine interne).
function statusLabel(s: SiteReportStatus): { label: string; cls: string } {
  switch (s) {
    case 'proposed':
      return { label: 'Analysé', cls: 'bg-sky-100 text-sky-700' }
    case 'curated':
    case 'archived':
      return { label: 'Validé', cls: 'bg-emerald-100 text-emerald-700' }
    case 'failed':
      return { label: 'Échec', cls: 'bg-red-100 text-red-700' }
    default:
      return { label: 'Brouillon', cls: 'bg-muted text-muted-foreground' }
  }
}

function relativeDay(iso: string, todayIso: string): string {
  const d = iso.slice(0, 10)
  if (d === todayIso) return "Aujourd'hui"
  const dt = new Date(iso)
  return dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; f?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const sp = searchParams ? await searchParams : {}
  const typeFilter = sp.type === 'contract' || sp.type === 'site' ? sp.type : 'all'
  const quickFilter = sp.f === 'actions' || sp.f === 'blocages' ? sp.f : null

  const [meetings, contracts, sites] = await Promise.all([
    listMeetings(),
    listContracts(),
    listSites(),
  ])

  const filtered = meetings.filter((m) => {
    if (typeFilter !== 'all' && m.type !== typeFilter) return false
    if (quickFilter === 'actions' && m.openActionCount === 0) return false
    if (quickFilter === 'blocages' && m.blockerCount === 0) return false
    return true
  })

  const todayIso = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  const draftFailedCount = meetings.filter((m) => m.status === 'draft' || m.status === 'failed').length
  const contractOptions = contracts.map((c) => ({ id: c.id, name: c.name }))
  const siteOptions = sites.map((s) => ({ id: s.id, name: s.name }))

  // Vue « Actions ouvertes » : les actions elles-mêmes, groupées par réunion.
  const actionsByReport = new Map<string, SiteActionRow[]>()
  if (quickFilter === 'actions' && filtered.length > 0) {
    const actions = await listOpenSiteActionsByReports(filtered.map((m) => m.id)).catch(() => [] as SiteActionRow[])
    for (const a of actions) {
      if (!a.report_id) continue
      if (!actionsByReport.has(a.report_id)) actionsByReport.set(a.report_id, [])
      actionsByReport.get(a.report_id)!.push(a)
    }
  }

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-transform active:scale-[0.97] ${
      active
        ? 'bg-foreground text-background border-foreground'
        : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
    }`
  const qs = (next: { type?: string; f?: string }) => {
    const p = new URLSearchParams()
    const t = next.type ?? (typeFilter !== 'all' ? typeFilter : undefined)
    const f = next.f ?? (quickFilter ?? undefined)
    if (t && t !== 'all') p.set('type', t)
    if (f) p.set('f', f)
    const s = p.toString()
    return s ? `/meetings?${s}` : '/meetings'
  }

  return (
    <div className="space-y-6 w-full">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Mic className="h-6 w-6 text-muted-foreground" />
            Réunions
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Réunion de chantier ou de contrat → décisions, actions ouvertes, blocages, briefing de demain.
            Le compte-rendu (voix, photos, notes) en est le support brut.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CleanupDraftMeetingsButton count={draftFailedCount} />
          <SiteBriefButton mode="meeting" sites={siteOptions} variant="desktop" />
          <NewMeetingButton contracts={contractOptions} sites={siteOptions} />
        </div>
      </header>

      {/* Filtres */}
      {meetings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={qs({ type: 'all' })} className={chip(typeFilter === 'all')}>Toutes</Link>
          <Link href={qs({ type: 'contract' })} className={chip(typeFilter === 'contract')}>
            <Building2 className="h-3 w-3" /> Contrat
          </Link>
          <Link href={qs({ type: 'site' })} className={chip(typeFilter === 'site')}>
            <MapPin className="h-3 w-3" /> Site
          </Link>
          <span className="mx-1 h-4 w-px bg-border" />
          <Link href={quickFilter === 'actions' ? qs({ f: '' }) : qs({ f: 'actions' })} className={chip(quickFilter === 'actions')}>
            <ListTodo className="h-3 w-3" /> Actions ouvertes
          </Link>
          <Link href={quickFilter === 'blocages' ? qs({ f: '' }) : qs({ f: 'blocages' })} className={chip(quickFilter === 'blocages')}>
            <AlertTriangle className="h-3 w-3" /> Blocages
          </Link>
        </div>
      )}

      {meetings.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="Aucune réunion"
          description="Lancez une réunion de contrat ou de chantier : dictez, photographiez, l'IA propose les décisions, vous validez."
        />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-1 py-6 text-center">
          {quickFilter === 'actions'
            ? 'Aucune action ouverte issue d’une réunion.'
            : quickFilter === 'blocages'
              ? 'Aucun blocage signalé en réunion.'
              : 'Aucune réunion ne correspond à ce filtre.'}
        </p>
      ) : quickFilter === 'actions' ? (
        // Vue actions : QUE les actions ouvertes, groupées par réunion (date desc).
        <div className="space-y-5">
          {filtered.map((m) => (
            <section key={m.id} className="space-y-2">
              <MeetingGroupHeader m={m} todayIso={todayIso} count={m.openActionCount} />
              <OpenActionsList actions={actionsByReport.get(m.id) ?? []} showSite />
            </section>
          ))}
        </div>
      ) : quickFilter === 'blocages' ? (
        // Vue blocages : QUE les blocages, groupés par réunion (date desc).
        <div className="space-y-5">
          {filtered.map((m) => (
            <section key={m.id} className="space-y-2">
              <MeetingGroupHeader m={m} todayIso={todayIso} count={m.blockerCount} />
              <ul className="space-y-1.5">
                {m.blockers.map((b, i) => (
                  <li key={i} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
                    <div className="font-medium text-amber-900">{b.label}</div>
                    {b.waiting_party && b.awaited && (
                      <div className="text-xs text-amber-800/80 mt-0.5">{b.waiting_party} attend {b.awaited}</div>
                    )}
                    {b.rationale && <div className="text-xs text-muted-foreground mt-0.5">{b.rationale}</div>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => (
            <MeetingRow key={m.id} m={m} todayIso={todayIso} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MeetingGroupHeader({ m, todayIso, count }: { m: MeetingListRow; todayIso: string; count: number }) {
  const isContract = m.type === 'contract'
  return (
    <div className="flex items-center gap-2 px-1">
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isContract ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'}`}>
        {isContract ? <Building2 className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
      </span>
      <Link href={`/meetings/${m.id}`} className="text-sm font-semibold hover:underline truncate">
        {meetingHeading(m)}
      </Link>
      <span className="text-xs text-muted-foreground capitalize shrink-0">· {relativeDay(m.createdAt, todayIso)}</span>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">{count}</span>
    </div>
  )
}

function MeetingRow({ m, todayIso }: { m: MeetingListRow; todayIso: string }) {
  const st = statusLabel(m.status)
  const isContract = m.type === 'contract'
  const heading = m.title
    ? m.title
    : isContract
      ? `Réunion contrat${m.contractName ? ` — ${m.contractName}` : ''}`
      : `Réunion site${m.siteNames[0] ? ` — ${m.siteNames[0]}` : ''}`

  const sitesLabel =
    m.siteNames.length === 0
      ? null
      : m.siteNames.length <= 2
        ? m.siteNames.join(', ')
        : `${m.siteNames.length} sites`

  return (
    <li className="relative">
      <Link
        href={`/meetings/${m.id}`}
        className="block rounded-lg border bg-card p-3.5 pr-11 hover:border-foreground/30 hover:bg-muted/20 transition-colors active:scale-[0.997]"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isContract ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'}`}>
            {isContract ? <Building2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{heading}</span>
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>
                {st.label}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground flex-wrap">
              <span className="capitalize">{relativeDay(m.createdAt, todayIso)}</span>
              {sitesLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{sitesLabel}
                </span>
              )}
              {m.decisionCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />{m.decisionCount} décision{m.decisionCount > 1 ? 's' : ''}
                </span>
              )}
              {m.openActionCount > 0 && (
                <span className="inline-flex items-center gap-1 text-sky-700">
                  <ListTodo className="h-3 w-3" />{m.openActionCount} action{m.openActionCount > 1 ? 's' : ''} ouverte{m.openActionCount > 1 ? 's' : ''}
                </span>
              )}
              {m.blockerCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-3 w-3" />{m.blockerCount} blocage{m.blockerCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
      {/* « Toutes les portes » — l'écran de travail GARDE sa destination :
          on vient ici pour rédiger, relire, compléter un compte-rendu, et le
          lien principal de la carte y mène toujours. La fiche du graphe est un
          SECOND accès, explicite et discret.
          Absent quand la réunion n'a pas UN chantier unique (réunion de contrat,
          ou plusieurs chantiers) : elle n'a alors pas de fiche site-scopée, et
          on ne fabrique pas une porte vers ce qui n'existe pas. */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        {m.ficheSiteId && (
          <Link
            href={`/sites/${m.ficheSiteId}/reunion/${m.id}`}
            scroll={false}
            title="Voir la fiche de la réunion"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Network className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Voir la fiche de la réunion</span>
          </Link>
        )}
        <DeleteMeetingButton reportId={m.id} label={heading} />
      </div>
    </li>
  )
}
