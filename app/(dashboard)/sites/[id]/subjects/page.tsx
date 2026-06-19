import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Layers, ChevronRight, ListTodo, ClipboardCheck, FileCheck2, FileText, Clock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSubjectsBySite, type SubjectSummary, type SubjectCriticality } from '@/lib/db/subjects'
import { createAdminClient } from '@/lib/supabase/admin'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SubjectCreateForm } from './SubjectCreateForm'

export const dynamic = 'force-dynamic'

// Criticité DÉRIVÉE, discrète (jamais un score anxiogène). Calme : pas de rouge vif.
const CRIT_DOT: Record<SubjectCriticality, string> = {
  haute: 'bg-amber-500', moyenne: 'bg-sky-500', basse: 'bg-slate-300',
}

function fmtRel(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days} j`
  const m = Math.floor(days / 30)
  return `il y a ${m} mois`
}

function SubjectRow({ siteId, s }: { siteId: string; s: SubjectSummary }) {
  return (
    <Link href={`/sites/${siteId}/subjects/${s.id}`}
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors">
      <span className={`h-2 w-2 rounded-full shrink-0 ${CRIT_DOT[s.criticality]}`} title={`criticité ${s.criticality}`} />
      <span className="font-medium text-sm flex-1 min-w-0 truncate">{s.name}</span>
      <span className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums shrink-0">
        <span className="inline-flex items-center gap-1"><ListTodo className="h-3 w-3" />{s.openActions}{s.lateActions > 0 ? ` (${s.lateActions} en retard)` : ''}</span>
        <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3 w-3" />{s.openReserves}</span>
        <span className="inline-flex items-center gap-1"><FileCheck2 className="h-3 w-3" />{s.decisions}</span>
        <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{s.documents}</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtRel(s.lastActivity)}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </Link>
  )
}

export default async function SiteSubjectsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const supabase = createAdminClient()
  const [identity, subjects, { data: scopeRows }] = await Promise.all([
    getSiteIdentity(id),
    listSubjectsBySite(id),
    supabase.from('memory_scopes').select('id, label').eq('site_id', id).is('deleted_at', null).eq('active', true),
  ])
  if (!identity) notFound()
  const scopes = (scopeRows ?? []) as { id: string; label: string }[]

  const openSubjects = subjects.filter((s) => s.status === 'open')
  const dormant = subjects.filter((s) => s.status === 'dormant')
  const closed = subjects.filter((s) => s.status === 'closed')

  return (
    <div className="space-y-6 w-full">
      <DynamicCrumb segmentId="subjects" label="Sujets" />
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${id}`, label: identity.name }]} />

      <Link href={`/sites/${id}`} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        ← {identity.name}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" /> Sujets
        </h1>
        <p className="text-xs text-muted-foreground">
          Les fils qui reviennent : un sujet regroupe dans le temps ses actions, réserves, décisions et documents.
          Un sujet = un problème / ouvrage / livrable, jamais une personne.
        </p>
      </header>

      <SubjectCreateForm siteId={id} scopes={scopes} />

      {subjects.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-6 text-center">
          Aucun sujet pour l&apos;instant. Créez-en un pour suivre un fil (DOE, essais, fissure…).
        </p>
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Ouverts <span className="text-xs text-muted-foreground tabular-nums">({openSubjects.length})</span></h2>
            {openSubjects.length === 0
              ? <p className="text-xs text-muted-foreground/80 italic">Aucun sujet ouvert.</p>
              : <div className="space-y-1.5">{openSubjects.map((s) => <SubjectRow key={s.id} siteId={id} s={s} />)}</div>}
          </section>
          {dormant.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">En sommeil <span className="text-xs tabular-nums">({dormant.length})</span></h2>
              <div className="space-y-1.5">{dormant.map((s) => <SubjectRow key={s.id} siteId={id} s={s} />)}</div>
            </section>
          )}
          {closed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Clos <span className="text-xs tabular-nums">({closed.length})</span></h2>
              <div className="space-y-1.5">{closed.map((s) => <SubjectRow key={s.id} siteId={id} s={s} />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
