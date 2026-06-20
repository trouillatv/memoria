import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  Mic, Building2, MapPin, Users, AlertTriangle, ListTodo, CalendarClock, ClipboardList,
  Eye, BookOpen, FileCheck2, FileText, ArrowLeft, CheckCircle2, Hourglass,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteReport, listProposals } from '@/lib/db/site-reports'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { getLatestReportDocument } from '@/lib/db/report-documents'
import { listReportFinalVersions } from '@/lib/db/report-final-versions'
import { getMeetingFollowup } from '@/lib/db/meeting-followup'
import { getSiteEngagements } from '@/lib/db/site-engagements'
import { ActionsCuration } from './ActionsCuration'
import { MeetingFollowup } from './MeetingFollowup'
import { EngagementsTable } from './EngagementsTable'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SiteReportProposalType, SiteReportStatus, DbSiteReportProposal } from '@/types/db'

export const dynamic = 'force-dynamic'

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

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const { id } = await params
  const report = await getSiteReport(id)
  if (!report) notFound()

  const [proposals, actions, pvDoc, followup, engagements, finalVersions] = await Promise.all([
    listProposals(id),
    listSiteActionsByReport(id),
    getLatestReportDocument(id),
    getMeetingFollowup({ id: report.id, site_id: report.site_id, created_at: report.created_at }),
    report.site_id ? getSiteEngagements(report.site_id) : Promise.resolve(null),
    listReportFinalVersions(id),
  ])
  const isPvValidated = pvDoc?.status === 'validated' || pvDoc?.status === 'exported'

  const supabase = createAdminClient()

  // Sites concernés (report_sites + site_id direct) + contrat
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

  const decisions = proposals
  const openActions = actions.filter((a) => a.status === 'open')
  const blockers = (report.risks ?? []).filter((r) => r.kind === 'dependency' || r.kind === 'risk')
  const otherRisks = (report.risks ?? []).filter((r) => r.kind === 'preparation' || r.kind === 'vigilance')

  // Site routé pour une décision (réunion contrat)
  const proposalSite = (p: DbSiteReportProposal) =>
    p.site_id ? siteName.get(p.site_id) ?? null : null

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

      {/* Suivi de la réunion précédente — PV de pilotage (Sprint 3) */}
      {followup && <MeetingFollowup data={followup} />}

      {/* Engagements à suivre — coordination par responsable (Sprint 4.5) */}
      {engagements && <EngagementsTable data={engagements} reportId={id} />}

      {/* Qui fait quoi, pour quand — curation des actions (Sprint 2) */}
      <ActionsCuration
        reportId={id}
        pendingProposals={proposals.filter((p) => p.type === 'action' && p.status === 'proposed')}
        actions={actions}
      />

      {/* Compte-rendu de chantier — l'écran de validation est le HUB central
          (corriger → prévisualiser → télécharger → téléverser le final → historique).
          La page réunion ne fait que pointer dessus (plus de panneau dupliqué). */}
      <Link
        href={`/meetings/${id}/pv/validation`}
        className="flex items-center gap-2.5 rounded-xl border bg-card p-3 hover:bg-muted/40"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Compte-rendu de chantier</span>
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

      {/* Participants détectés */}
      {report.participants && report.participants.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Présents</h2>
          <div className="flex flex-wrap gap-1.5">
            {report.participants.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs">
                <Users className="h-3 w-3 text-muted-foreground" />
                {p.name}{p.role ? <span className="text-muted-foreground"> · {p.role}</span> : null}
              </span>
            ))}
          </div>
        </section>
      )}

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

      {/* Blocages / dépendances */}
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

      {/* Autres vigilances / préparations */}
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

      {/* Compte-rendu brut (support) */}
      {(report.transcript_corrected || report.transcript_raw || report.text_input) && (
        <details className="group rounded-lg border bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Compte-rendu brut
          </summary>
          <div className="border-t px-4 py-3 text-sm whitespace-pre-wrap text-foreground/80">
            {report.transcript_corrected || report.transcript_raw || report.text_input}
          </div>
        </details>
      )}
    </div>
  )
}
