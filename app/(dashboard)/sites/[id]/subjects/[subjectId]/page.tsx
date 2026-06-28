import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Layers, ListTodo, ClipboardCheck, FileCheck2, FileText, Gavel, History, CalendarClock, AlertTriangle, Target, Quote, Lightbulb, Camera } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getLivingDossier } from '@/lib/db/living-dossier'
import { getOrgId } from '@/lib/db/users'
import { getSubjectOrgHistory } from '@/lib/db/ao-experience'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { createAdminClient } from '@/lib/supabase/admin'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { SubjectDetailControls } from './SubjectDetailControls'
import { SubjectRelationControls } from './SubjectRelationControls'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = { open: 'Ouvert', dormant: 'En sommeil', closed: 'Clos' }
const ACTION_STATUS_FR: Record<string, string> = { open: 'à faire', planned: 'planifiée', done: 'faite', cancelled: 'annulée' }

export default async function SubjectDetailPage({ params }: { params: Promise<{ id: string; subjectId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, subjectId } = await params
  // Source CANONIQUE unique du dossier vivant (identité + thread + timeline +
  // insights + relations + infos retenues + captures). Affichage inchangé.
  const dossier = await getLivingDossier(id, subjectId)
  if (!dossier) notFound()
  const { identity, thread, timeline, insights, relations } = dossier
  // Niveau 3 — le même sujet canonique à l'échelle de l'org (du local au collectif).
  const orgHistory = await getSubjectOrgHistory(await getOrgId().catch(() => null), thread.subject.name).catch(() => null)
  const { subject, actions, reserves, decisions, siteDecisions, anomalies, documents } = thread
  const fr = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : null

  // Vue Sujet enrichie (Sprint A) — « répondre en 5 secondes ». Tout dérivé de la
  // timeline et du thread DÉJÀ chargés (zéro requête de plus) : dernière trace +
  // d'où vient l'histoire (réunions / documents / obligations).
  const lastEvent = timeline.length ? timeline[timeline.length - 1] : null
  const meetingSources = [...new Set(timeline.map((e) => e.reportLabel).filter((x): x is string => !!x))]
  const obligationCount = timeline.filter((e) => e.kind === 'obligation').length
  const sourceBits: string[] = []
  if (meetingSources.length) sourceBits.push(`${meetingSources.length} réunion${meetingSources.length > 1 ? 's' : ''}`)
  if (documents.length) sourceBits.push(`${documents.length} document${documents.length > 1 ? 's' : ''}`)
  if (obligationCount) sourceBits.push(`${obligationCount} obligation${obligationCount > 1 ? 's' : ''}`)

  // P1 « Sujet actif » — bloc ⚠ Vigilance : ce qui APPELLE l'attention, dérivé de
  // insights + timeline (déjà chargés, zéro requête de plus). On passe de l'« historique »
  // à l'« attention ». Déterministe, zéro IA, jamais un score d'acteur.
  const vigilance: string[] = []
  if (insights) {
    if (insights.ageDays != null && insights.ageDays >= 30 && insights.status === 'open')
      vigilance.push(`Ouvert depuis ${insights.ageDays} jours`)
    if (insights.blocksCount > 0)
      vigilance.push(`Bloque ${insights.blocksCount} sujet${insights.blocksCount > 1 ? 's' : ''}${insights.criticalImpact ? ' (dont un critique)' : ''}`)
    if (insights.recurring)
      vigilance.push(`Cité dans ${insights.meetingsCount} réunions, toujours ouvert`)
    if (insights.slippages > 0)
      vigilance.push(`Échéance repoussée ${insights.slippages} fois`)
    if (insights.openActions > 0)
      vigilance.push(`${insights.openActions} action${insights.openActions > 1 ? 's' : ''} ouverte${insights.openActions > 1 ? 's' : ''}`)
  }
  if (timeline.some((e) => e.kind === 'origin')) vigilance.push('Engagement contractuel (origine au dossier)')
  if (timeline.some((e) => e.kind === 'obligation' && /produire|en cours/i.test(e.meta ?? ''))) vigilance.push('Obligation non encore satisfaite')
  const showVigilance = vigilance.length > 0 && insights?.state !== 'clos'

  // Candidats à rattacher (existant non encore rattaché à ce sujet).
  const supabase = createAdminClient()
  const linkedDocIds = new Set(documents.map((d) => d.id))
  const [{ data: candActions }, { data: candReserves }, { data: candDecisions }, siteDocs] = await Promise.all([
    supabase.from('site_actions').select('id, title').eq('site_id', id).is('subject_id', null).in('status', ['open', 'planned']).limit(50),
    supabase.from('site_reserve').select('id, label').eq('site_id', id).is('subject_id', null).eq('status', 'open').limit(50),
    supabase.from('site_report_proposals').select('id, short_label').eq('site_id', id).is('subject_id', null).eq('status', 'accepted').limit(50),
    listDocumentsForTarget('site', id).catch(() => []),
  ])
  // Anomalies candidates : intervention (non résolues, via missions→interventions) +
  // anomalies saisies en séance (report_added_points kind anomalie via les CR du site).
  const { data: missions } = await supabase.from('missions').select('id').eq('site_id', id).is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id as string)
  let candAnomalies: { id: string; label: string }[] = []
  if (missionIds.length > 0) {
    const { data: intvs } = await supabase.from('interventions').select('id').in('mission_id', missionIds)
    const intvIds = (intvs ?? []).map((i) => i.id as string)
    if (intvIds.length > 0) {
      const { data: anoms } = await supabase.from('intervention_anomalies').select('id, description, category_other').in('intervention_id', intvIds).is('subject_id', null).is('resolved_at', null).limit(50)
      candAnomalies = (anoms ?? []).map((a) => ({ id: a.id as string, label: ((a.description as string | null) ?? (a.category_other as string | null) ?? '(anomalie)').trim() }))
    }
  }
  const { data: siteReps } = await supabase.from('site_reports').select('id').eq('site_id', id)
  const repIds = (siteReps ?? []).map((r) => r.id as string)
  let candAddedAnomalies: { id: string; label: string }[] = []
  if (repIds.length > 0) {
    const { data: ap } = await supabase.from('report_added_points').select('id, label').in('report_id', repIds).eq('kind', 'anomalie').is('subject_id', null).limit(50)
    candAddedAnomalies = (ap ?? []).map((a) => ({ id: a.id as string, label: a.label as string }))
  }
  const candidates = {
    actions: ((candActions ?? []) as { id: string; title: string }[]).map((a) => ({ id: a.id, label: a.title })),
    reserves: ((candReserves ?? []) as { id: string; label: string }[]).map((r) => ({ id: r.id, label: r.label })),
    decisions: ((candDecisions ?? []) as { id: string; short_label: string }[]).map((d) => ({ id: d.id, label: d.short_label })),
    anomalies: candAnomalies,
    addedAnomalies: candAddedAnomalies,
    documents: siteDocs.filter((d) => !linkedDocIds.has(d.id)).map((d) => ({ id: d.id, label: d.filename })),
  }

  // Sujets candidats à bloquer : les autres sujets du site, sauf soi-même et ceux déjà
  // bloqués par ce sujet (l'arête from=ce sujet existe déjà).
  const alreadyBlocked = new Set(relations.blocks.map((r) => r.subjectId))
  const { data: siteSubjects } = await supabase.from('subjects').select('id, name').eq('site_id', id).neq('id', subjectId).neq('status', 'closed').order('name')
  const relationCandidates = ((siteSubjects ?? []) as { id: string; name: string }[]).filter((s) => !alreadyBlocked.has(s.id))

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

      {/* VIGILANCE (P1 « Sujet actif ») — l'attention AVANT l'histoire. Le sujet ne se
          contente plus de raconter : il signale ce qui appelle une action. */}
      {showVigilance && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-1.5">
          <h2 className="text-sm font-semibold text-rose-700 inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Vigilance</h2>
          <ul className="space-y-0.5">
            {vigilance.map((v, i) => (
              <li key={i} className="text-sm text-rose-900/90 flex items-start gap-1.5"><span className="mt-1 text-rose-500">•</span><span>{v}</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* ÉTAT DU SUJET — l'intelligence (« pourquoi c'est encore ouvert ? »). Tout
          dérivé, déterministe, zéro IA. La cause porte sa confiance quand déduite. */}
      {insights && (
        <section className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              const cls: Record<string, string> = { bloqué: 'bg-rose-100 text-rose-700', en_attente: 'bg-amber-100 text-amber-800', dormant: 'bg-slate-100 text-slate-600', ouvert: 'bg-sky-100 text-sky-700', clos: 'bg-emerald-100 text-emerald-700' }
              const label: Record<string, string> = { bloqué: 'Bloqué', en_attente: 'En attente', dormant: 'En sommeil', ouvert: 'Ouvert', clos: 'Clos' }
              return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls[insights.state]}`}>{label[insights.state]}</span>
            })()}
            {insights.ageDays != null && <span className="text-xs text-muted-foreground">depuis {insights.ageDays} j</span>}
            <span className="text-xs text-muted-foreground">· énergie {insights.energy}</span>
          </div>
          <dl className="space-y-1 text-sm">
            {insights.cause && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-muted-foreground">Cause :</dt>
                <dd>{insights.cause.text} <span className={`text-[11px] ${insights.cause.confidence === 'élevée' ? 'text-emerald-700' : insights.cause.confidence === 'moyenne' ? 'text-amber-700' : 'text-muted-foreground'}`}>(confiance {insights.cause.confidence})</span></dd>
              </div>
            )}
            {insights.lastEvolution && <div className="flex flex-wrap gap-x-2"><dt className="font-medium text-muted-foreground">Dernière évolution :</dt><dd>{insights.lastEvolution}</dd></div>}
            {lastEvent && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-muted-foreground">Dernière trace :</dt>
                <dd>{fr(lastEvent.date)}{lastEvent.reportLabel ? ` · ${lastEvent.reportLabel}` : ''} <span className="text-muted-foreground">— {lastEvent.label}</span></dd>
              </div>
            )}
            {sourceBits.length > 0 && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-muted-foreground">Sources :</dt>
                <dd>{sourceBits.join(' · ')}{meetingSources.length ? ` — ${meetingSources.join(', ')}` : ''}</dd>
              </div>
            )}
            {insights.nextStep && <div className="flex flex-wrap gap-x-2"><dt className="font-medium text-muted-foreground">À faire :</dt><dd>{insights.nextStep}</dd></div>}
            {insights.openQuestion && <div className="flex flex-wrap gap-x-2"><dt className="font-medium text-muted-foreground">Question ouverte :</dt><dd className="italic">{insights.openQuestion}</dd></div>}
            {insights.blocksCount > 0 && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-muted-foreground">Impact :</dt>
                <dd>{insights.criticalImpact && <span className="mr-1 text-rose-700">⚠</span>}bloque {insights.blocksCount} sujet{insights.blocksCount > 1 ? 's' : ''}{insights.criticalImpact ? ' (dont un critique)' : ''}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* SYNTHÈSE « Sujet vivant » (P3) : l'exploitation déterministe de l'histoire —
          âge, réunions, promesses, reports, récurrence. Zéro IA, zéro score d'acteur. */}
      {insights && (insights.ageDays != null || insights.meetingsCount > 0) && (
        <section className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {insights.ageDays != null && <span><strong>{insights.ageDays} j</strong> d&apos;ancienneté</span>}
            <span><strong>{insights.meetingsCount}</strong> réunion{insights.meetingsCount > 1 ? 's' : ''} concernée{insights.meetingsCount > 1 ? 's' : ''}</span>
            <span><strong>{insights.decisionsCount}</strong> décision{insights.decisionsCount > 1 ? 's' : ''}</span>
            <span><strong>{insights.openActions}</strong> action{insights.openActions > 1 ? 's' : ''} ouverte{insights.openActions > 1 ? 's' : ''}</span>
            {insights.deadlines.length > 0 && (
              <span><strong>{insights.deadlines.length}</strong> échéance{insights.deadlines.length > 1 ? 's' : ''} annoncée{insights.deadlines.length > 1 ? 's' : ''}{insights.lastDeadline ? ` · dernière : ${fr(insights.lastDeadline)}` : ''}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {insights.recurring && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">⚠ Sujet récurrent — {insights.meetingsCount} réunions, toujours ouvert</span>
            )}
            {insights.slippages > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">⚠ Échéance repoussée {insights.slippages} fois</span>
            )}
          </div>
          {insights.deadlines.length > 1 && (
            <div className="text-[11px] text-muted-foreground">
              Échéances annoncées : {insights.deadlines.map((p) => fr(p.dueDate)).join(' → ')}
            </div>
          )}
          {insights.status === 'open' && insights.lastDeadline && (
            <p className="text-xs text-muted-foreground border-t pt-2">
              Question à poser : « {subject.name} sera-t-il tenu pour le {fr(insights.lastDeadline)} ? »
            </p>
          )}
        </section>
      )}

      {/* Niveau 3 — du local au collectif : ce même sujet à l'échelle de l'org. */}
      {orgHistory && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-1">
          <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <History className="h-4 w-4 text-amber-700" /> À l&apos;échelle de l&apos;organisation
            {orgHistory.difficult && <span className="text-[10px] font-semibold text-amber-700">· historiquement difficile</span>}
          </h2>
          <p className="text-sm text-muted-foreground">
            « {orgHistory.term} » rencontré <strong className="text-foreground">{orgHistory.occurrences} fois</strong> sur {orgHistory.projectCount} chantier{orgHistory.projectCount > 1 ? 's' : ''}
            {orgHistory.lateProjects > 0 ? ` · ${orgHistory.lateRatioPct}% en retard` : ''}
            {orgHistory.reserveCount > 0 ? ` · ${orgHistory.reserveCount} réserve${orgHistory.reserveCount > 1 ? 's' : ''}` : ''}
            {orgHistory.lateDaysCumulative > 0 ? ` · ${orgHistory.lateDaysCumulative} j cumulés de retard` : ''}
            {orgHistory.avgClosureDays != null ? ` · clôture moyenne ${orgHistory.avgClosureDays} j` : ''}.
          </p>
          {orgHistory.causes.length > 0 && (
            <p className="text-[11px] text-muted-foreground/90">
              Causes récurrentes : {orgHistory.causes.map((c) => `${c.label}${c.count > 1 ? ` (${c.count})` : ''}`).join(' · ')}
            </p>
          )}
          {orgHistory.successFactors.length > 0 && (
            <p className="text-[11px] text-emerald-700/90">
              Observé sur les réussites ({orgHistory.successes}) vs les ratés ({orgHistory.failures}) :{' '}
              {orgHistory.successFactors.map((f) => `${f.label} ${f.successPct}% vs ${f.failurePct}%`).join(' · ')}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70">Historique factuel cross-chantiers, déterministe — pas une prédiction.</p>
        </section>
      )}

      <SubjectDetailControls siteId={id} subjectId={subjectId} name={subject.name} status={subject.status} candidates={candidates} />

      {/* DÉPENDANCES entre sujets (mig 145) — « ce sujet bloque … » / « en attente de … ».
          Arête dirigée, raison obligatoire, acte humain. Pas de cascade, pas de graphe. */}
      <SubjectRelationControls
        siteId={id} subjectId={subjectId} subjectName={subject.name}
        blocks={relations.blocks} blockedBy={relations.blockedBy} candidates={relationCandidates}
      />

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
              const Icon = e.kind === 'reserve' ? ClipboardCheck : e.kind === 'action' ? ListTodo : e.kind === 'document' ? FileText : e.kind === 'anomaly' ? AlertTriangle : e.kind === 'obligation' ? Target : e.kind === 'origin' ? Quote : e.kind === 'knowledge' ? Lightbulb : e.kind === 'capture' ? Camera : Gavel
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

      {/* Anomalies (mig 144) — la cause concrète du blocage. */}
      {anomalies.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /> Anomalies ({anomalies.length})</h2>
          <ul className="space-y-1">
            {anomalies.map((a) => (
              <li key={a.id} className="text-sm rounded-md border bg-card px-3 py-1.5">
                <span className="font-medium">{a.label}</span>
                <span className="text-muted-foreground"> · {a.open ? 'non résolue' : 'résolue'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
