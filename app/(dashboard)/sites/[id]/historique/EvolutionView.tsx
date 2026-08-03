import Link from 'next/link'
import { cn } from '@/lib/utils'
import type {
  EvolutionReadModel,
  EvolutionNarrative,
  EvolutionSubjectFact,
} from '@/lib/documents/pv-evolution'

// ── Phase detection algorithm (déterministe, générique) ───────────────────────

type PhaseType = 'start' | 'critical' | 'resolution' | 'recovery' | 'stable' | 'neutral' | 'silence'

interface PhaseInfo {
  type: PhaseType
  label: string
  punchline: string
}

function computePhase(
  period: EvolutionReadModel['periods'][number],
  opts: { isFirst: boolean; prevWasSilence: boolean },
): PhaseInfo {
  if (period.isSilence) {
    const days = period.silenceDays ?? '?'
    return {
      type: 'silence',
      label: 'Silence documentaire',
      punchline: `${days} jours sans procès-verbal`,
    }
  }

  const a = period.appeared.length
  const g = period.aggravated.length
  const r = period.resolved.length

  if (opts.isFirst && a > 0 && g === 0) {
    return {
      type: 'start',
      label: 'Démarrage',
      punchline:
        a === 1
          ? 'Premier sujet entre dans le suivi'
          : `${a} sujets entrent dans le suivi`,
    }
  }

  if (opts.prevWasSilence && (r > 0 || a > 0)) {
    const parts: string[] = []
    if (a > 0) parts.push(`${a} nouveau${a > 1 ? 'x' : ''} sujet${a > 1 ? 's' : ''}`)
    if (r > 0) parts.push(`${r} traitement${r > 1 ? 's' : ''}`)
    return {
      type: 'recovery',
      label: 'Reprise',
      punchline: parts.join(', '),
    }
  }

  if (a >= 4 && g >= 1) {
    return {
      type: 'critical',
      label: 'Montée des difficultés',
      punchline: `${a} nouveaux sujets${g > 1 ? `, ${g} aggravations` : ', 1 aggravation'}`,
    }
  }

  if (a >= 3 && g === 0) {
    return {
      type: 'neutral',
      label: 'Expansion du suivi',
      punchline: `${a} nouveaux sujets entrent dans le suivi`,
    }
  }

  if (g >= 2 && r === 0) {
    return {
      type: 'critical',
      label: 'Phase critique',
      punchline: `${g} sujets s'aggravent ou rouvrent`,
    }
  }

  if (g >= 1 && r === 0 && a === 0) {
    return {
      type: 'critical',
      label: 'Tensions',
      punchline: `${g} sujet${g > 1 ? 's aggravés' : ' aggravé'}, aucune résolution`,
    }
  }

  if (r >= 3 && g === 0 && a <= 1) {
    return {
      type: 'resolution',
      label: 'Phase de résolution',
      punchline: `${r} sujets traités${a > 0 ? `, ${a} nouveau` : ''}`,
    }
  }

  if (r > 0 && g === 0 && a === 0) {
    return {
      type: 'resolution',
      label: 'Avancement',
      punchline: `${r} sujet${r > 1 ? 's traités' : ' traité'}, pas de nouvelle difficulté`,
    }
  }

  if (a > 0 && r > 0 && g === 0) {
    return {
      type: 'neutral',
      label: 'Évolution mixte',
      punchline: `${a} apparu${a > 1 ? 's' : ''}, ${r} traité${r > 1 ? 's' : ''}`,
    }
  }

  if (a === 0 && g === 0 && r === 0) {
    return {
      type: 'stable',
      label: 'Stabilité',
      punchline: 'Aucune transition — sujets en cours',
    }
  }

  return {
    type: 'neutral',
    label: 'Évolution',
    punchline: [
      a > 0 ? `${a} apparu${a > 1 ? 's' : ''}` : null,
      g > 0 ? `${g} aggravé${g > 1 ? 's' : ''}` : null,
      r > 0 ? `${r} traité${r > 1 ? 's' : ''}` : null,
    ]
      .filter(Boolean)
      .join(', ') || 'Sujets en cours',
  }
}

// ── Styles par type de phase ──────────────────────────────────────────────────

const PHASE_STYLES: Record<
  PhaseType,
  { dot: string; badge: string; cardBorder: string; bg: string }
> = {
  start: {
    dot:        'bg-blue-500 ring-blue-200 dark:ring-blue-900',
    badge:      'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    cardBorder: 'border-blue-200 dark:border-blue-900/60',
    bg:         'bg-blue-50/30 dark:bg-blue-950/10',
  },
  critical: {
    dot:        'bg-red-500 ring-red-200 dark:ring-red-900',
    badge:      'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    cardBorder: 'border-red-200 dark:border-red-900/60',
    bg:         'bg-red-50/30 dark:bg-red-950/10',
  },
  resolution: {
    dot:        'bg-emerald-500 ring-emerald-200 dark:ring-emerald-900',
    badge:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    cardBorder: 'border-emerald-200 dark:border-emerald-900/60',
    bg:         'bg-emerald-50/20 dark:bg-emerald-950/10',
  },
  recovery: {
    dot:        'bg-teal-500 ring-teal-200 dark:ring-teal-900',
    badge:      'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',
    cardBorder: 'border-teal-200 dark:border-teal-900/60',
    bg:         'bg-teal-50/20 dark:bg-teal-950/10',
  },
  stable: {
    dot:        'bg-slate-400 ring-slate-100 dark:ring-slate-800',
    badge:      'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    cardBorder: 'border-border',
    bg:         '',
  },
  neutral: {
    dot:        'bg-slate-500 ring-slate-100 dark:ring-slate-800',
    badge:      'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
    cardBorder: 'border-border',
    bg:         '',
  },
  silence: {
    dot:        'bg-slate-300 dark:bg-slate-600 ring-slate-100 dark:ring-slate-800',
    badge:      'bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400',
    cardBorder: 'border-dashed border-border',
    bg:         'bg-muted/20',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShortMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

// ── Groupe de sujets ──────────────────────────────────────────────────────────

const FACT_CONFIG = {
  appeared: {
    label:     'Entrent dans le suivi',
    linkColor: 'text-foreground/90 hover:text-foreground',
  },
  aggravated: {
    label:     'S\'aggravent ou rouvrent',
    linkColor: 'text-red-700 dark:text-red-400 hover:underline',
  },
  resolved: {
    label:     'Sont traités',
    linkColor: 'text-emerald-700 dark:text-emerald-400 hover:underline',
  },
  stillOpen: {
    label:     'Restent actifs',
    linkColor: 'text-muted-foreground hover:text-foreground',
  },
} as const

type FactKey = keyof typeof FACT_CONFIG

function SubjectList({
  kind,
  facts,
  siteId,
}: {
  kind: FactKey
  facts: EvolutionSubjectFact[]
  siteId: string
}) {
  if (facts.length === 0) return null
  const cfg = FACT_CONFIG[kind]

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {cfg.label} ({facts.length})
      </p>
      <ul className="space-y-1">
        {facts.map((fact) => {
          const tags: string[] = []
          if (fact.openActions > 0)  tags.push(`${fact.openActions} act.`)
          if (fact.openReserves > 0) tags.push(`${fact.openReserves} rés.`)
          if (fact.hasDeadlines)     tags.push('éch.')

          return (
            <li key={fact.canonicalSubjectId} className="flex items-start gap-2">
              <Link
                href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                className={cn(
                  'flex-1 truncate text-sm underline-offset-2',
                  cfg.linkColor,
                )}
              >
                {fact.label}
              </Link>
              {tags.length > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">{tags.join(' · ')}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Carte silence ─────────────────────────────────────────────────────────────

function SilenceCard({
  period,
  styles,
  narrativeText,
  siteId,
}: {
  period: EvolutionReadModel['periods'][number]
  styles: (typeof PHASE_STYLES)[PhaseType]
  narrativeText: string | null
  siteId: string
}) {
  return (
    <div className={cn('rounded-[18px] border p-4', styles.cardBorder, styles.bg)}>
      <div className="flex items-center gap-3">
        <div>
          <p className="text-sm font-semibold">
            {period.silenceDays ?? '?'} jours sans procès-verbal
          </p>
          <p className="text-xs text-muted-foreground">
            {fmtDate(period.startDate)} → {fmtDate(period.endDate)}
          </p>
        </div>
      </div>

      {period.stillOpen.length > 0 && (
        <div className="mt-3 border-t border-dashed border-border pt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sujets en attente pendant ce silence ({period.stillOpen.length})
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {period.stillOpen.map((fact) => (
              <li key={fact.canonicalSubjectId}>
                <Link
                  href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                  className="inline-flex items-center rounded-full bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground"
                >
                  {fact.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {narrativeText && (
        <p className="mt-3 text-xs italic text-muted-foreground">{narrativeText}</p>
      )}
    </div>
  )
}

// ── Carte période normale ─────────────────────────────────────────────────────

function PeriodCard({
  period,
  phase,
  styles,
  narrativeText,
  siteId,
}: {
  period: EvolutionReadModel['periods'][number]
  phase: PhaseInfo
  styles: (typeof PHASE_STYLES)[PhaseType]
  narrativeText: string | null
  siteId: string
}) {
  const pvLabel =
    period.pvNumbers.length === 0
      ? null
      : period.pvNumbers.length === 1
        ? `PV${period.pvNumbers[0]}`
        : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  return (
    <div className={cn('rounded-[18px] border bg-card p-5 shadow-sm', styles.cardBorder, styles.bg)}>
      {/* En-tête : badge phase + punchline */}
      <div className="mb-1 flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', styles.badge)}>
          {phase.label}
        </span>
        {pvLabel && (
          <span className="text-xs font-medium text-muted-foreground">{pvLabel}</span>
        )}
      </div>

      <p className="text-base font-semibold leading-snug">{phase.punchline}</p>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {period.startDate === period.endDate
          ? fmtDate(period.startDate)
          : `${fmtShortMonth(period.startDate)}`}
      </p>

      {/* Narration */}
      {narrativeText && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground italic">
          {narrativeText}
        </p>
      )}

      {/* Faits */}
      {(period.appeared.length > 0 || period.aggravated.length > 0 ||
        period.resolved.length > 0  || period.stillOpen.length > 0) && (
        <div className={cn(
          'mt-3 space-y-3 border-t border-border pt-3',
          narrativeText && 'mt-3',
        )}>
          <SubjectList kind="appeared"   facts={period.appeared}   siteId={siteId} />
          <SubjectList kind="aggravated" facts={period.aggravated} siteId={siteId} />
          <SubjectList kind="resolved"   facts={period.resolved}   siteId={siteId} />
          <SubjectList kind="stillOpen"  facts={period.stillOpen}  siteId={siteId} />
        </div>
      )}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export interface EvolutionViewProps {
  siteId: string
  readModel: EvolutionReadModel
  narrative: EvolutionNarrative
}

export function EvolutionView({ siteId, readModel, narrative }: EvolutionViewProps) {
  if (readModel.periods.length === 0) {
    return (
      <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
        <p className="font-medium">Pas assez de données pour reconstituer l'évolution.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Au moins deux PV analysés avec des sujets liés à un suivi canonique sont nécessaires.
        </p>
      </section>
    )
  }

  const narrativeByLabel = new Map(narrative.periods.map((p) => [p.periodLabel, p.text]))

  const activePeriods = readModel.periods.filter((p) => !p.isSilence).length
  const silencePeriods = readModel.periods.filter((p) => p.isSilence).length

  return (
    <div className="space-y-4">
      {/* En-tête résumé */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Chronique du chantier</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{readModel.totalRuns}</span> PV analysés
          </span>
          {readModel.dateRange && (
            <span>
              {fmtDate(readModel.dateRange.start)} → {fmtDate(readModel.dateRange.end)}
            </span>
          )}
          <span>
            <span className="font-medium text-foreground">{activePeriods}</span>{' '}
            période{activePeriods > 1 ? 's' : ''} active{activePeriods > 1 ? 's' : ''}
            {silencePeriods > 0 && ` · ${silencePeriods} silence${silencePeriods > 1 ? 's' : ''}`}
          </span>
          {!narrative.deterministic && narrative.model && (
            <span className="text-xs text-muted-foreground/60">narration IA</span>
          )}
        </div>
      </section>

      {/* Frise verticale */}
      <div className="relative">
        {/* Ligne verticale continue */}
        <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden />

        <div className="space-y-3">
          {readModel.periods.map((period, idx) => {
            const prevPeriod = idx > 0 ? readModel.periods[idx - 1] : null
            const prevWasSilence = prevPeriod?.isSilence ?? false
            const isFirst = !prevPeriod || (prevPeriod.isSilence && idx === 1)

            const phase  = computePhase(period, { isFirst: idx === 0, prevWasSilence })
            const styles = PHASE_STYLES[phase.type]
            const narrativeText = narrativeByLabel.get(period.label) ?? null

            return (
              <div key={period.isSilence ? `silence-${idx}` : period.runIds?.[0] ?? idx}
                   className="relative pl-6">
                {/* Dot */}
                <div
                  className={cn(
                    'absolute left-0 top-4 h-3.5 w-3.5 rounded-full ring-2 ring-background',
                    styles.dot,
                    period.isSilence && 'border-2 border-dashed border-slate-300 dark:border-slate-600 bg-background ring-0',
                  )}
                  aria-hidden
                />

                {period.isSilence ? (
                  <SilenceCard
                    period={period}
                    styles={styles}
                    narrativeText={narrativeText}
                    siteId={siteId}
                  />
                ) : (
                  <PeriodCard
                    period={period}
                    phase={phase}
                    styles={styles}
                    narrativeText={narrativeText}
                    siteId={siteId}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
