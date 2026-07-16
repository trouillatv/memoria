import Link from 'next/link'
import type { ComponentType } from 'react'
import { AlertTriangle, CalendarClock, Check, ChevronRight, Footprints, Info, RefreshCw, ShieldAlert, Sparkles, Users } from 'lucide-react'
import type { SiteOverview } from '@/lib/knowledge/site-overview'
import { sourceLabels, visitDateLabel, durationLabel, synthesisLabel } from '@/lib/chantier/overview-labels'

// ── CE QUE LA VISITE A SERVI (fiche mobile) ──────────────────────────────────
// Le terrain est l'endroit où Guillaume SORT de sa visite, le téléphone à la main.
// C'est donc là, en premier, qu'il doit voir que sa visite a produit quelque chose :
// la date, ce qu'elle a rapporté, l'état de la synthèse, et ce que MemorIA en a
// retenu. Ces objets vivaient déjà dans SiteOverview et n'atteignaient que le
// bureau — un objet métier n'est terminé que lorsqu'il est visible partout où il
// apporte de la valeur.
//
// Cette carte est le PENDANT mobile de l'onglet Aperçu : mêmes données (un seul
// read model), mêmes mots (lib/chantier/overview-labels), mise en forme du pouce.

export function VisitKnowledgeCard({
  overview,
  synthesisHref,
}: {
  overview: SiteOverview
  synthesisHref?: string
}) {
  const { activity, synthesis, stakeholders, deadlines, knowledge, watchpoints } = overview
  const lastVisit = activity.lastVisit
  const retainedTotal = stakeholders.summary.proposed + stakeholders.summary.confirmed
    + deadlines.summary.proposed + deadlines.summary.confirmed
    + knowledge.summary.proposed + knowledge.summary.confirmed
    + watchpoints.summary.proposed + watchpoints.summary.confirmed

  // Silence total : un chantier jamais visité et sans connaissance ne montre rien.
  if (!lastVisit && retainedTotal === 0) return null

  const sources = lastVisit ? sourceLabels(lastVisit.sources) : []
  if (lastVisit?.durationMin != null) sources.push(`Durée ${durationLabel(lastVisit.durationMin)}`)

  return (
    <section className="rounded-2xl border bg-card p-4">
      {lastVisit && (
        <>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/30">
              <Footprints className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dernière visite</h2>
              <p className="text-base font-semibold">{visitDateLabel(lastVisit.endedAt)}</p>
            </div>
          </div>

          {/* Les SOURCES : la matière réelle sur laquelle MemorIA a travaillé. */}
          <p className="mt-2 text-[13px] text-muted-foreground">
            {lastVisit.sourceCount === 0 ? 'Aucune capture' : sources.join(' · ')}
          </p>

          <div className="mt-2">
            <SynthesisChip status={synthesis.status} pending={synthesis.pending} />
          </div>

          {/* Un échec ne doit JAMAIS être muet : sans ça, la visite paraît n'avoir rien
              produit alors que MemorIA avait compris. On parle CHANTIER, jamais « projection ». */}
          {synthesis.projectionFailed && (
            <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Certaines informations de cette visite n&apos;ont pas encore pu être intégrées au chantier.
                La synthèse, elle, est intacte.
              </span>
            </p>
          )}
        </>
      )}

      {retainedTotal > 0 && (
        <div className={lastVisit ? 'mt-4 border-t pt-3' : undefined}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ce que MemorIA a retenu
            </h2>
          </div>
          <div className="mt-2 space-y-3">
            <KnowledgeGroup title="Intervenants" icon={Users} section={stakeholders} />
            <KnowledgeGroup title="Échéances" icon={CalendarClock} section={deadlines} />
            <KnowledgeGroup title="À savoir" icon={Info} section={knowledge} />
            <KnowledgeGroup title="Points de vigilance" icon={ShieldAlert} section={watchpoints} />
          </div>
        </div>
      )}

      {synthesisHref && (
        <Link
          href={synthesisHref}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary active:opacity-70"
        >
          Voir la synthèse <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  )
}

/** Le VALIDÉ d'abord, le PROPOSÉ ensuite — jamais mélangés. Silence quand vide. */
function KnowledgeGroup({
  title,
  icon: Icon,
  section,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  section: SiteOverview['knowledge']
}) {
  const total = section.summary.proposed + section.summary.confirmed
  if (total === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
        <span className="text-[13px] font-semibold tabular-nums">{total}</span>
        {section.summary.proposed > 0 && (
          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            {section.summary.proposed} à confirmer
          </span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {section.confirmed.map((item) => (
          <li key={item.id} className="line-clamp-2 text-[13px] text-foreground/90">{item.title}</li>
        ))}
        {section.proposed.map((item) => (
          <li key={item.id} className="line-clamp-2 text-[13px] text-muted-foreground">{item.title}</li>
        ))}
      </ul>
    </div>
  )
}

/** L'état de la synthèse — les mots viennent du vocabulaire partagé, jamais d'ici. */
function SynthesisChip({
  status,
  pending,
}: {
  status: SiteOverview['synthesis']['status']
  pending: SiteOverview['synthesis']['pending']
}) {
  const { label, tone } = synthesisLabel(status, pending)
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    stale: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
    working: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
    none: 'bg-muted text-muted-foreground',
  }[tone]
  const Icon = tone === 'ok' ? Check : tone === 'none' ? null : RefreshCw
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${cls}`}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />} {label}
    </span>
  )
}
