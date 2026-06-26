import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Layers, ChevronRight, ListTodo, ClipboardCheck, FileCheck2, FileText, Clock, AlertTriangle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSubjectsBySite, searchSiteSubjects, getSubjectLinkageHealth, listSiteSubjectsToWatch, type SubjectSummary, type SubjectCriticality, type SubjectSearchResult, type SubjectLinkageHealth, type LinkageStat, type SubjectWatch } from '@/lib/db/subjects'
import { createAdminClient } from '@/lib/supabase/admin'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SubjectCreateForm } from './SubjectCreateForm'
import { SubjectSearch } from './SubjectSearch'

export const dynamic = 'force-dynamic'

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  bloqué: { label: 'Bloqué', cls: 'bg-rose-100 text-rose-700' },
  en_attente: { label: 'En attente', cls: 'bg-amber-100 text-amber-800' },
  dormant: { label: 'En sommeil', cls: 'bg-slate-100 text-slate-600' },
  ouvert: { label: 'Ouvert', cls: 'bg-sky-100 text-sky-700' },
  clos: { label: 'Clos', cls: 'bg-emerald-100 text-emerald-700' },
}

/** Carte résultat de recherche : la FICHE du sujet (Vincent : « taper DOE → tout »). */
function SearchResultCard({ siteId, r }: { siteId: string; r: SubjectSearchResult }) {
  const ins = r.insights
  const b = STATE_BADGE[ins.state] ?? STATE_BADGE.ouvert
  return (
    <Link href={`/sites/${siteId}/subjects/${r.id}`}
      className="block rounded-xl border bg-card p-4 hover:border-foreground/30 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>{b.label}</span>
        <span className="font-semibold">{r.name}</span>
        {r.hasObligation && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Obligation permanente</span>}
        {ins.criticalImpact && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">⚠ critique</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">trouvé par {r.matchedVia}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground">
        {ins.ageDays != null && <span>ouvert depuis <strong>{ins.ageDays} j</strong></span>}
        <span><strong>{ins.meetingsCount}</strong> réunion{ins.meetingsCount > 1 ? 's' : ''}</span>
        <span><strong>{ins.decisionsCount}</strong> décision{ins.decisionsCount > 1 ? 's' : ''}</span>
        <span><strong>{ins.openActions}</strong> action{ins.openActions > 1 ? 's' : ''} ouverte{ins.openActions > 1 ? 's' : ''}</span>
        {ins.openReserves > 0 && <span><strong>{ins.openReserves}</strong> réserve{ins.openReserves > 1 ? 's' : ''} ouverte{ins.openReserves > 1 ? 's' : ''}</span>}
        {ins.deadlines.length > 0 && <span><strong>{ins.deadlines.length}</strong> échéance{ins.deadlines.length > 1 ? 's' : ''}{ins.slippages > 0 ? ` (repoussée ${ins.slippages}×)` : ''}</span>}
        {ins.blocksCount > 0 && <span>bloque <strong>{ins.blocksCount}</strong> sujet{ins.blocksCount > 1 ? 's' : ''}</span>}
        <span>énergie <strong>{ins.energy}</strong></span>
      </div>
      <dl className="mt-1.5 space-y-0.5 text-[12px]">
        {ins.cause && <div><dt className="inline font-medium text-muted-foreground">Cause : </dt><dd className="inline">{ins.cause.text}</dd></div>}
        {ins.lastEvolution && <div><dt className="inline font-medium text-muted-foreground">Dernière évolution : </dt><dd className="inline">{ins.lastEvolution}</dd></div>}
        {ins.nextStep && <div><dt className="inline font-medium text-muted-foreground">Prochaine étape : </dt><dd className="inline">{ins.nextStep}</dd></div>}
        {ins.openQuestion && <div className="italic text-muted-foreground">{ins.openQuestion}</div>}
      </dl>
    </Link>
  )
}

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

function pctTone(pct: number): string {
  return pct >= 70 ? 'text-emerald-700' : pct >= 40 ? 'text-amber-700' : 'text-rose-700'
}
function barTone(pct: number): string {
  return pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-400'
}

/** Le « pourquoi » d'un sujet à surveiller, en une ligne (pour la synthèse exécutive). */
function watchHeadline(w: SubjectWatch): string {
  if (w.cause) return w.cause
  if (w.state === 'bloqué') return 'bloqué'
  if (w.ageDays != null && w.ageDays >= 30) return `ouvert depuis ${w.ageDays} jours`
  if (w.blocksCount > 0) return `bloque ${w.blocksCount} sujet${w.blocksCount > 1 ? 's' : ''}`
  if (w.openQuestion) return w.openQuestion
  return w.lastEvolution ?? 'à surveiller'
}

/** SYNTHÈSE EXÉCUTIVE (P2) — « ce qui appelle l'attention en priorité ». Le dirigeant
 *  lit 3 lignes, pas 25. Réutilise listSiteSubjectsToWatch (déterministe). */
function ExecutiveSummary({ siteId, watch }: { siteId: string; watch: SubjectWatch[] }) {
  if (watch.length === 0) return null
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-rose-700 inline-flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4" /> À surveiller en priorité
      </h2>
      <ol className="space-y-1">
        {watch.map((w, i) => (
          <li key={w.id}>
            <Link href={`/sites/${siteId}/subjects/${w.id}`} className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-rose-100/50">
              <span className="tabular-nums font-semibold text-rose-700">{i + 1}.</span>
              <span className="text-sm">
                <span className="font-medium">{w.name}</span>
                <span className="text-rose-900/80"> — {watchHeadline(w)}</span>
                {w.criticalImpact && <span className="ml-1 text-rose-600" title="impact critique">⚠</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Santé de rattachement — KPI INTERNE (Vincent), indicatif et jamais bloquant.
 *  Un objet sans sujet est invisible à la recherche : ce panneau dit si le chantier
 *  est assez rattaché pour que la recherche démontre bien (avant de la montrer). */
function LinkageHealthPanel({ h }: { h: SubjectLinkageHealth }) {
  const total = h.actions.total + h.decisions.total + h.reserves.total + h.obligations.total + h.documents.total
  if (total === 0) return null
  // Ordre métier (le plus structurant d'abord). Barres = pilotage objectif :
  // « la Vue Sujet est vide parce que X % seulement est rattaché », pas « ça marche pas ».
  const items: { label: string; s: LinkageStat }[] = [
    { label: 'Décisions', s: h.decisions }, { label: 'Actions', s: h.actions },
    { label: 'Réserves', s: h.reserves }, { label: 'Documents', s: h.documents },
    { label: 'Obligations', s: h.obligations },
  ]
  return (
    <section className="rounded-lg border bg-muted/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Couverture du graphe (interne)</span>
        <span className={`text-[11px] font-medium ${pctTone(h.overallPct)}`}>{h.overallPct}% rattaché</span>
      </div>
      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{it.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              {it.s.total > 0 && <div className={`h-full rounded-full ${barTone(it.s.pct)}`} style={{ width: `${it.s.pct}%` }} />}
            </div>
            <span className={`w-20 shrink-0 text-right text-[11px] font-medium ${it.s.total === 0 ? 'text-muted-foreground/60' : pctTone(it.s.pct)}`}>
              {it.s.total === 0 ? '—' : `${it.s.pct}% (${it.s.linked}/${it.s.total})`}
            </span>
          </div>
        ))}
        {/* Honnête : Photos & interventions ne sont pas encore rattachables (étapes suivantes). */}
        <div className="flex items-center gap-2 opacity-60">
          <span className="w-24 shrink-0 text-[11px] text-muted-foreground">Photos · interv.</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" />
          <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground/60">à venir</span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground/70">Plus un objet est rattaché à un élément, plus la recherche, le Journal et la Vue Sujet le retrouvent. Indicatif, non bloquant.</p>
    </section>
  )
}

export default async function SiteSubjectsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const supabase = createAdminClient()
  const [identity, subjects, { data: scopeRows }, results, linkage, watch] = await Promise.all([
    getSiteIdentity(id),
    listSubjectsBySite(id),
    supabase.from('memory_scopes').select('id, label').eq('site_id', id).is('deleted_at', null).eq('active', true),
    query ? searchSiteSubjects(id, query) : Promise.resolve([] as SubjectSearchResult[]),
    getSubjectLinkageHealth(id),
    listSiteSubjectsToWatch(id, 3),
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

      {!query && <ExecutiveSummary siteId={id} watch={watch} />}

      <LinkageHealthPanel h={linkage} />

      <SubjectSearch siteId={id} initial={query} />

      {query ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Résultats pour « {query} » <span className="text-xs text-muted-foreground tabular-nums">({results.length})</span></h2>
          {results.length === 0
            ? <p className="text-sm text-muted-foreground italic py-4 text-center">Aucun sujet ne correspond à « {query} » sur ce chantier.</p>
            : <div className="space-y-2">{results.map((r) => <SearchResultCard key={r.id} siteId={id} r={r} />)}</div>}
        </section>
      ) : (
      <>
      <SubjectCreateForm siteId={id} scopes={scopes} existingNames={subjects.map((s) => s.name)} />

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
      </>
      )}
    </div>
  )
}
