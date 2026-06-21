import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Layers, ListTodo, ClipboardCheck, FileCheck2, FileText, Gavel, History, CalendarClock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getSubjectThread, getSubjectTimeline } from '@/lib/db/subjects'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { createAdminClient } from '@/lib/supabase/admin'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SubjectDetailControls } from './SubjectDetailControls'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = { open: 'Ouvert', dormant: 'En sommeil', closed: 'Clos' }
const ACTION_STATUS_FR: Record<string, string> = { open: 'à faire', planned: 'planifiée', done: 'faite', cancelled: 'annulée' }

export default async function SubjectDetailPage({ params }: { params: Promise<{ id: string; subjectId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, subjectId } = await params
  const [identity, thread, timeline] = await Promise.all([getSiteIdentity(id), getSubjectThread(subjectId), getSubjectTimeline(subjectId)])
  if (!identity || !thread || thread.subject.site_id !== id) notFound()
  const { subject, actions, reserves, decisions, siteDecisions, documents } = thread

  // Candidats à rattacher (existant non encore rattaché à ce sujet).
  const supabase = createAdminClient()
  const linkedDocIds = new Set(documents.map((d) => d.id))
  const [{ data: candActions }, { data: candReserves }, { data: candDecisions }, siteDocs] = await Promise.all([
    supabase.from('site_actions').select('id, title').eq('site_id', id).is('subject_id', null).in('status', ['open', 'planned']).limit(50),
    supabase.from('site_reserve').select('id, label').eq('site_id', id).is('subject_id', null).eq('status', 'open').limit(50),
    supabase.from('site_report_proposals').select('id, short_label').eq('site_id', id).is('subject_id', null).eq('status', 'accepted').limit(50),
    listDocumentsForTarget('site', id).catch(() => []),
  ])
  const candidates = {
    actions: ((candActions ?? []) as { id: string; title: string }[]).map((a) => ({ id: a.id, label: a.title })),
    reserves: ((candReserves ?? []) as { id: string; label: string }[]).map((r) => ({ id: r.id, label: r.label })),
    decisions: ((candDecisions ?? []) as { id: string; short_label: string }[]).map((d) => ({ id: d.id, label: d.short_label })),
    documents: siteDocs.filter((d) => !linkedDocIds.has(d.id)).map((d) => ({ id: d.id, label: d.filename })),
  }

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <DynamicCrumb segmentId={subjectId} label={subject.name} />
      <BreadcrumbPrefix crumbs={[
        { href: '/sites', label: 'Sites' },
        { href: `/sites/${id}`, label: identity.name },
        { href: `/sites/${id}/subjects`, label: 'Sujets' },
      ]} />

      <Link href={`/sites/${id}/subjects`} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        ← Sujets
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{subject.name}</h1>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {STATUS_LABEL[subject.status] ?? subject.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{identity.name}{identity.clientName ? ` · ${identity.clientName}` : ''}</p>
      </header>

      <SubjectDetailControls siteId={id} subjectId={subjectId} status={subject.status} candidates={candidates} />

      {/* HISTORIQUE CHRONOLOGIQUE — l'histoire complète du sujet (Vincent : « un sujet =
          l'histoire d'un problème, pas une liste d'occurrences »). Tous les objets
          rattachés, datés, situés à leur réunion. Du plus ancien au plus récent. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /> Historique du sujet ({timeline.length})</h2>
        {timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground/80 italic">Rien de rattaché pour l&apos;instant — rattachez des décisions, actions ou réserves ci-dessous, ou depuis l&apos;écran de validation du PV.</p>
        ) : (
          <ol className="relative space-y-2 border-l-2 border-muted pl-4">
            {timeline.map((e, i) => {
              const Icon = e.kind === 'reserve' ? ClipboardCheck : e.kind === 'action' ? ListTodo : e.kind === 'document' ? FileText : Gavel
              const date = e.date ? new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
              return (
                <li key={`${e.kind}-${i}`} className="relative">
                  <span className="absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full bg-muted-foreground/40" aria-hidden />
                  <div className="rounded-md border bg-card px-3 py-1.5 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="tabular-nums text-[11px] text-muted-foreground">{date}</span>
                      {e.reportLabel && <span className="text-[11px] text-muted-foreground">· {e.reportLabel}</span>}
                    </span>
                    <span className="ml-1.5 font-medium">{e.label}</span>
                    {e.meta && <span className="block text-[11px] text-muted-foreground">{e.meta}</span>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* Décisions structurées (site_decisions, reliées mig 143) */}
      {siteDecisions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold inline-flex items-center gap-2"><Gavel className="h-4 w-4 text-violet-600" /> Décisions ({siteDecisions.length})</h2>
          <ul className="space-y-1">
            {siteDecisions.map((d) => (
              <li key={d.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <span className="font-medium">{d.titre}</span>
                <span className="text-muted-foreground"> · {d.statut}</span>
                {d.dateDecision && <span className="text-muted-foreground"> · <CalendarClock className="inline h-3 w-3" /> {d.dateDecision}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2"><ListTodo className="h-4 w-4 text-sky-600" /> Actions ({actions.length})</h2>
        {actions.length === 0 ? <p className="text-xs text-muted-foreground/80 italic">Aucune action rattachée.</p> : (
          <ul className="space-y-1">
            {actions.map((a) => (
              <li key={a.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <span className="font-medium">{a.title}</span>
                {a.assigned_to && <span className="text-muted-foreground"> — {a.assigned_to}</span>}
                {a.due_date && <span className="text-muted-foreground"> · échéance {a.due_date}</span>}
                <span className="text-muted-foreground"> · {ACTION_STATUS_FR[a.status] ?? a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Réserves */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-amber-600" /> Réserves ({reserves.length})</h2>
        {reserves.length === 0 ? <p className="text-xs text-muted-foreground/80 italic">Aucune réserve rattachée.</p> : (
          <ul className="space-y-1">
            {reserves.map((r) => (
              <li key={r.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground"> · {r.status === 'lifted' ? 'levée' : 'ouverte'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Décisions */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-indigo-600" /> Décisions ({decisions.length})</h2>
        {decisions.length === 0 ? <p className="text-xs text-muted-foreground/80 italic">Aucune décision rattachée.</p> : (
          <ul className="space-y-1">
            {decisions.map((d) => (
              <li key={d.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <span className="font-medium">{d.short_label}</span>
                {d.corps_etat && <span className="text-muted-foreground"> · {d.corps_etat}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Documents */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2"><FileText className="h-4 w-4 text-violet-600" /> Documents ({documents.length})</h2>
        {documents.length === 0 ? <p className="text-xs text-muted-foreground/80 italic">Aucun document rattaché.</p> : (
          <ul className="space-y-1">
            {documents.map((d) => (
              <li key={d.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <Link href={`/documents/${d.id}`} className="hover:underline">{d.filename}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
