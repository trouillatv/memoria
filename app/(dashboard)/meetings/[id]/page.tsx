import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  Mic, Building2, MapPin, AlertTriangle, ListTodo, CalendarClock, ClipboardList,
  Eye, BookOpen, FileCheck2, FileText, ArrowLeft, CheckCircle2, Hourglass, Users, UserX,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport, listProposals, getSiteAttendanceStats } from '@/lib/db/site-reports'
import { getMeetingEnrichments } from '@/lib/db/meeting-enrichments'
import { MeetingMemoryPanel } from './MeetingMemoryPanel'
import { listBlocagesByReport } from '@/lib/db/site-blocages'
import { guessBlocageType } from '@/lib/db/blocage-constants'
import { BlocagesPanel } from './BlocagesPanel'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { getLatestReportDocument } from '@/lib/db/report-documents'
import { listReportFinalVersions } from '@/lib/db/report-final-versions'
import { listDistributionStatusForReport } from '@/lib/db/action-distribution'
import { getMeetingFollowup } from '@/lib/db/meeting-followup'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { listAudioSources, computeMemoryHealth } from '@/lib/db/report-audio-sources'
import { listAnalysisRuns } from '@/lib/db/report-analysis-runs'
import { listSiteContacts } from '@/lib/db/site-intervenants'
import { responsibleKey, canonicalLabel } from '@/lib/engagements/responsible-key'
import { MeetingMemoryHealth } from './MeetingMemoryHealth'
import { MeetingParticipantsEditor } from './MeetingParticipantsEditor'
import { ActionsCuration } from './ActionsCuration'
import { MeetingFollowup } from './MeetingFollowup'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SiteReportProposalType, SiteReportStatus, DbSiteReportProposal } from '@/types/db'

export const dynamic = 'force-dynamic'
// La relance de transcription (action serveur de cette page) peut être longue sur un
// audio de réunion → on autorise jusqu'à 300 s.
export const maxDuration = 300

// Onglets métier (par URL → consultation, fetch limité à l'onglet courant).
const TABS = ['participants', 'pv', 'decisions', 'blocages', 'historique'] as const
type TabKey = (typeof TABS)[number]

const TYPE_META: Record<SiteReportProposalType, { label: string; icon: typeof ListTodo; cls: string }> = {
  action: { label: 'Action', icon: ListTodo, cls: 'text-sky-600' },
  intervention: { label: 'Intervention', icon: CalendarClock, cls: 'text-indigo-600' },
  mission: { label: 'Mission', icon: ClipboardList, cls: 'text-violet-600' },
  anomaly: { label: 'Anomalie', icon: AlertTriangle, cls: 'text-amber-600' },
  vigilance: { label: 'Vigilance', icon: Eye, cls: 'text-orange-600' },
  note: { label: 'Note', icon: BookOpen, cls: 'text-emerald-600' },
  client_memory: { label: 'Mémoire client', icon: Building2, cls: 'text-teal-600' },
  proof_request: { label: 'Preuve attendue', icon: FileCheck2, cls: 'text-rose-600' },
}

function statusLabel(s: SiteReportStatus): { label: string; cls: string } {
  switch (s) {
    case 'proposed': return { label: 'Analysé', cls: 'bg-sky-100 text-sky-700' }
    case 'curated':
    case 'archived': return { label: 'Validé', cls: 'bg-emerald-100 text-emerald-700' }
    case 'failed': return { label: 'Échec', cls: 'bg-red-100 text-red-700' }
    default: return { label: 'Brouillon', cls: 'bg-muted text-muted-foreground' }
  }
}

/**
 * Vue « Par responsable » des actions de CETTE réunion (coordination, jamais
 * évaluation). Même esprit que l'ex-section « Engagements » mais scopée à la
 * réunion, pas au site entier (la vue site vit dans le hub Actions du chantier).
 * Tri alphabétique, aucun score / % / classement. `ouvertes` = open|planned.
 */
function groupByResponsible(actions: Array<{ status: string; assigned_to?: string | null; due_date?: string | null }>) {
  const today = new Date().toISOString().slice(0, 10)
  const isOpen = (s: string) => s === 'open' || s === 'planned'
  let sansResponsable = 0
  const groups = new Map<string, { variants: string[]; ouvertes: number; enRetard: number }>()
  for (const a of actions) {
    if (a.status === 'cancelled') continue
    const raw = (a.assigned_to ?? '').trim()
    if (!raw) { if (isOpen(a.status)) sansResponsable += 1; continue }
    const k = responsibleKey(raw)
    let g = groups.get(k)
    if (!g) { g = { variants: [], ouvertes: 0, enRetard: 0 }; groups.set(k, g) }
    g.variants.push(raw)
    if (isOpen(a.status)) {
      g.ouvertes += 1
      if (a.due_date != null && a.due_date < today) g.enRetard += 1
    }
  }
  const responsables = [...groups.values()]
    .map((g) => ({ label: canonicalLabel(g.variants), ouvertes: g.ouvertes, enRetard: g.enRetard }))
    .filter((g) => g.ouvertes > 0)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  return { responsables, sansResponsable }
}

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ onglet?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { id } = await params
  const { onglet } = await searchParams
  const tab: TabKey = (TABS as readonly string[]).includes(onglet ?? '') ? (onglet as TabKey) : 'participants'

  const report = await getSiteReport(id)
  if (!report) notFound()

  // Toujours chargé : compteurs de la barre d'onglets (+ matière des onglets
  // Décisions & Actions / Blocages). Léger.
  const [proposals, actions, blocages] = await Promise.all([
    listProposals(id),
    listSiteActionsByReport(id),
    listBlocagesByReport(id),
  ])
  const decisions = proposals
  const openActions = actions.filter((a) => a.status === 'open')
  const participantsCount = report.participants?.length ?? 0

  // En-tête : sites concernés (report_sites + site_id direct) + contrat.
  const supabase = createAdminClient()
  const { data: linkRows } = await supabase.from('report_sites').select('site_id').eq('report_id', id)
  const siteIdSet = new Set<string>()
  if (report.site_id) siteIdSet.add(report.site_id)
  for (const l of (linkRows ?? []) as Array<{ site_id: string }>) siteIdSet.add(l.site_id)
  const siteIds = [...siteIdSet]
  const siteName = new Map<string, string>()
  if (siteIds.length > 0) {
    const { data: ss } = await supabase.from('sites').select('id, name').in('id', siteIds)
    for (const s of (ss ?? []) as Array<{ id: string; name: string }>) siteName.set(s.id, s.name)
  }
  const { data: contractRow } = report.contract_id
    ? await supabase.from('contracts').select('id, name').eq('id', report.contract_id).maybeSingle()
    : { data: null }
  const contractName = (contractRow as { name: string } | null)?.name ?? null

  const isContract = report.type === 'contract'
  const st = statusLabel(report.status)
  const heading = report.title
    ? report.title
    : isContract
      ? `Réunion contrat${contractName ? ` — ${contractName}` : ''}`
      : `Réunion site${siteName.get(report.site_id ?? '') ? ` — ${siteName.get(report.site_id ?? '')}` : ''}`

  const dateLabel = new Date(report.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Site routé pour une décision (réunion contrat).
  const proposalSite = (p: DbSiteReportProposal) =>
    p.site_id ? siteName.get(p.site_id) ?? null : null

  const tabMeta: Array<{ key: TabKey; label: string; count: string | null }> = [
    { key: 'participants', label: 'Participants', count: participantsCount > 0 ? String(participantsCount) : null },
    { key: 'pv', label: 'Préparer le PV', count: null },
    { key: 'decisions', label: 'Décisions & Actions', count: `${decisions.length} · ${openActions.length}` },
    { key: 'blocages', label: 'Blocages', count: blocages.length > 0 ? String(blocages.length) : null },
    { key: 'historique', label: 'Historique', count: null },
  ]

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <Link href="/meetings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Réunions
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${isContract ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'}`}>
            {isContract ? <Building2 className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
          </span>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
            {st.label}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1 capitalize">
            <Mic className="h-3.5 w-3.5" />{dateLabel}
          </span>
          {siteIds.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {siteIds.map((sid) => siteName.get(sid) ?? '—').join(', ')}
            </span>
          )}
        </div>
      </header>

      {report.status === 'failed' && report.analysis_error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          L&apos;analyse a échoué : {report.analysis_error}. Le compte-rendu brut et ses pièces restent conservés.
        </div>
      )}

      {/* Onglets métier — chaque onglet ne charge que ce dont il a besoin. */}
      <nav className="flex gap-1 overflow-x-auto border-b">
        {tabMeta.map((t) => (
          <Link
            key={t.key}
            href={`/meetings/${id}?onglet=${t.key}`}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              t.key === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs tabular-nums opacity-70">({t.count})</span>}
          </Link>
        ))}
      </nav>

      {tab === 'participants' && (
        <ParticipantsTab reportId={id} report={report} />
      )}

      {tab === 'pv' && (
        <PvTab reportId={id} siteId={report.site_id} />
      )}

      {tab === 'decisions' && (
        <DecisionsTab
          reportId={id}
          report={report}
          decisions={decisions}
          actions={actions}
          openActions={openActions}
          proposalSite={proposalSite}
        />
      )}

      {tab === 'blocages' && (
        <BlocagesTab reportId={id} report={report} blocages={blocages} />
      )}

      {tab === 'historique' && (
        <HistoriqueTab reportId={id} report={report} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Onglet : Participants                                               */
/* ------------------------------------------------------------------ */
async function ParticipantsTab({
  reportId,
  report,
}: {
  reportId: string
  report: Awaited<ReturnType<typeof getSiteReport>>
}) {
  if (!report) return null
  const castingContacts = report.site_id ? await listSiteContacts(report.site_id).catch(() => []) : []
  const attendance = report.site_id
    ? await getSiteAttendanceStats(report.site_id, reportId).catch(() => ({ totalMeetings: 0, present: {}, lastMeetingContactIds: [] }))
    : { totalMeetings: 0, present: {}, lastMeetingContactIds: [] }

  return (
    <MeetingParticipantsEditor
      reportId={reportId}
      participants={report.participants ?? []}
      castingContacts={castingContacts}
      attendance={attendance}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Onglet : Préparer le PV (création / validation du CR)              */
/* ------------------------------------------------------------------ */
async function PvTab({ reportId, siteId }: { reportId: string; siteId: string | null }) {
  const [pvDoc, finalVersions, audioSources, memoryHealth, analysisRuns] = await Promise.all([
    getLatestReportDocument(reportId),
    listReportFinalVersions(reportId),
    listAudioSources(reportId),
    computeMemoryHealth(reportId),
    listAnalysisRuns(reportId),
  ])
  const isPvValidated = pvDoc?.status === 'validated' || pvDoc?.status === 'exported'

  // Briefing déterministe : ce qui traîne sur le SITE avant la réunion.
  const memorySignals = siteId ? await buildSiteMemorySignals(siteId) : []
  const briefingCount = memorySignals.reduce((n, s) => n + s.items.length, 0)

  return (
    <div className="space-y-6">
      {/* Compte-rendu de chantier — hub de création/validation du PV. */}
      <Link
        href={`/meetings/${reportId}/pv/validation`}
        className="flex items-center gap-2.5 rounded-xl border bg-card p-3 hover:bg-muted/40"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Rédiger le compte-rendu</span>
        {isPvValidated && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Référence archivée
          </span>
        )}
        {finalVersions.length > 0 && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {finalVersions.length} version{finalVersions.length > 1 ? 's' : ''} finale{finalVersions.length > 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">Préparer / finaliser →</span>
      </Link>

      {/* Préparer cette réunion — briefing déterministe. */}
      {siteId && (
        <Link href={`/meetings/${reportId}/briefing`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4 text-muted-foreground" /> Préparer cette réunion
          </span>
          <span className="text-xs text-muted-foreground">
            {briefingCount > 0 ? `${briefingCount} point${briefingCount > 1 ? 's' : ''} à surveiller` : 'Ouvrir le briefing'} →
          </span>
        </Link>
      )}

      {/* Santé de la mémoire — qualité de capture (≠ détecteurs chantier). */}
      <MeetingMemoryHealth reportId={reportId} sources={audioSources} health={memoryHealth} analysisRuns={analysisRuns} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Onglet : Décisions & Actions (+ vue « Par responsable »)           */
/* ------------------------------------------------------------------ */
async function DecisionsTab({
  reportId,
  report,
  decisions,
  actions,
  openActions,
  proposalSite,
}: {
  reportId: string
  report: NonNullable<Awaited<ReturnType<typeof getSiteReport>>>
  decisions: DbSiteReportProposal[]
  actions: Awaited<ReturnType<typeof listSiteActionsByReport>>
  openActions: Awaited<ReturnType<typeof listSiteActionsByReport>>
  proposalSite: (p: DbSiteReportProposal) => string | null
}) {
  const [actionLots, followup] = await Promise.all([
    listDistributionStatusForReport(reportId),
    getMeetingFollowup({ id: report.id, site_id: report.site_id, created_at: report.created_at }),
  ])
  const byResponsible = groupByResponsible(actions)

  return (
    <div className="space-y-6">
      {/* Suivi de la réunion précédente — on revoit les engagements antérieurs. */}
      {followup && <MeetingFollowup data={followup} />}

      {/* Qui fait quoi, pour quand — curation des actions. */}
      <ActionsCuration
        reportId={reportId}
        siteId={report.site_id}
        pendingProposals={decisions.filter((p) => p.type === 'action' && p.status === 'proposed')}
        actions={actions}
        lots={actionLots}
      />

      {/* Décisions */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Décisions ({decisions.length})
        </h2>
        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Aucune décision détectée.</p>
        ) : (
          <ul className="space-y-1.5">
            {decisions.map((d) => {
              const meta = TYPE_META[d.type] ?? TYPE_META.action
              const Icon = meta.icon
              const site = proposalSite(d)
              const rejected = d.status === 'rejected'
              return (
                <li key={d.id} className={`rounded-lg border bg-card p-3 ${rejected ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${meta.cls}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm ${rejected ? 'line-through' : ''}`}>{d.short_label}</div>
                      <div className="mt-1 flex items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground flex-wrap">
                        <span className="uppercase tracking-wide font-medium">{meta.label}</span>
                        {d.corps_etat && <span>· {d.corps_etat}</span>}
                        {site && <span className="inline-flex items-center gap-0.5">· <MapPin className="h-2.5 w-2.5" />{site}</span>}
                        {d.status === 'accepted' && d.created_entity_id && (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600">· <CheckCircle2 className="h-2.5 w-2.5" />créée</span>
                        )}
                        {d.status === 'proposed' && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600">· <Hourglass className="h-2.5 w-2.5" />à valider</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Actions ouvertes */}
      {openActions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <ListTodo className="h-3.5 w-3.5 text-sky-600" /> Actions ouvertes ({openActions.length})
          </h2>
          <ul className="space-y-1.5">
            {openActions.map((a) => (
              <li key={a.id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-start gap-2">
                  <ListTodo className="h-4 w-4 shrink-0 mt-0.5 text-sky-600" />
                  <div className="min-w-0">
                    <div>{a.title}</div>
                    {(a.corps_etat || a.due_date) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {a.corps_etat}{a.corps_etat && a.due_date ? ' · ' : ''}{a.due_date ? `échéance ${a.due_date}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Par responsable — vue de coordination des actions de CETTE réunion
          (ex « Engagements à suivre », jamais une évaluation individuelle). */}
      {(byResponsible.responsables.length > 0 || byResponsible.sansResponsable > 0) && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Par responsable
          </h2>
          <div className="rounded-xl border bg-card p-4 space-y-3">
            {byResponsible.sansResponsable > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
                <span className="inline-flex items-center gap-2 font-medium text-amber-900">
                  <UserX className="h-4 w-4 text-amber-600" /> Sans responsable
                </span>
                <span className="tabular-nums text-amber-800">{byResponsible.sansResponsable} à attribuer</span>
              </div>
            )}
            {byResponsible.responsables.length > 0 && (
              <ul className="divide-y">
                {byResponsible.responsables.map((g) => (
                  <li key={g.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{g.label}</span>
                    <span className="shrink-0 inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>{g.ouvertes} à suivre</span>
                      {g.enRetard > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                          <AlertTriangle className="h-3 w-3" /> {g.enRetard} en retard
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Onglet : Blocages                                                  */
/* ------------------------------------------------------------------ */
function BlocagesTab({
  reportId,
  report,
  blocages,
}: {
  reportId: string
  report: NonNullable<Awaited<ReturnType<typeof getSiteReport>>>
  blocages: Awaited<ReturnType<typeof listBlocagesByReport>>
}) {
  const blockers = (report.risks ?? []).filter((r) => r.kind === 'dependency' || r.kind === 'risk')
  const otherRisks = (report.risks ?? []).filter((r) => r.kind === 'preparation' || r.kind === 'vigilance')

  // Détection PV → proposition de blocage (l'IA propose, l'humain valide).
  const blocageSuggestions = blockers.map((r) => ({
    label: r.label,
    rationale: r.rationale ?? null,
    type: guessBlocageType(`${r.label} ${r.rationale ?? ''}`),
  }))

  return (
    <div className="space-y-6">
      {report.site_id && (
        <BlocagesPanel
          reportId={reportId}
          siteId={report.site_id}
          suggestions={blocageSuggestions}
          blocages={blocages.map((b) => ({
            id: b.id, type: b.type, title: b.title, impact: b.impact,
            dateStart: b.dateStart, dateEnd: b.dateEnd,
          }))}
        />
      )}

      {blockers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Blocages &amp; dépendances ({blockers.length})
          </h2>
          <ul className="space-y-1.5">
            {blockers.map((r, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
                <div className="font-medium text-amber-900">{r.label}</div>
                {r.waiting_party && r.awaited && (
                  <div className="text-xs text-amber-800/80 mt-0.5">{r.waiting_party} attend {r.awaited}</div>
                )}
                {r.rationale && <div className="text-xs text-muted-foreground mt-0.5">{r.rationale}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherRisks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">À surveiller</h2>
          <ul className="space-y-1.5">
            {otherRisks.map((r, i) => (
              <li key={i} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-start gap-2">
                  <Eye className="h-4 w-4 shrink-0 mt-0.5 text-orange-500" />
                  <div className="min-w-0">
                    <div>{r.label}</div>
                    {r.rationale && <div className="text-xs text-muted-foreground mt-0.5">{r.rationale}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Onglet : Historique (passé de cette réunion)                       */
/* ------------------------------------------------------------------ */
async function HistoriqueTab({
  reportId,
  report,
}: {
  reportId: string
  report: NonNullable<Awaited<ReturnType<typeof getSiteReport>>>
}) {
  const [finalVersions, enrichments] = await Promise.all([
    listReportFinalVersions(reportId),
    getMeetingEnrichments(reportId).catch(() => []),
  ])
  const rawText = report.transcript_corrected || report.transcript_raw || report.text_input

  return (
    <div className="space-y-6">
      {/* PV figé inchangé, nouveautés à intégrer, journal des enrichissements. */}
      <MeetingMemoryPanel
        reportId={reportId}
        hasFinalPv={finalVersions.length > 0}
        lastPvAt={finalVersions.reduce<string | null>((m, v) => (!m || v.finalizedAt > m ? v.finalizedAt : m), null)}
        enrichments={enrichments}
      />

      {/* Compte-rendu brut (support). */}
      {rawText && (
        <details className="group rounded-lg border bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Compte-rendu brut
          </summary>
          <div className="border-t px-4 py-3 text-sm whitespace-pre-wrap text-foreground/80">
            {rawText}
          </div>
        </details>
      )}
    </div>
  )
}
