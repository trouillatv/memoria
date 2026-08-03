import Link from 'next/link'
import { cn } from '@/lib/utils'
import type {
  EvolutionReadModel,
  EvolutionNarrative,
  EvolutionSubjectFact,
} from '@/lib/documents/pv-evolution'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Groupe de sujets dans une période ─────────────────────────────────────────

const FACT_CONFIG = {
  appeared: {
    icon: '◉',
    label: 'Apparus',
    color: 'text-blue-600 dark:text-blue-400',
    linkColor: 'text-foreground hover:text-blue-600 dark:hover:text-blue-400',
  },
  aggravated: {
    icon: '⚠',
    label: 'Aggravés / réouverts',
    color: 'text-red-600 dark:text-red-400',
    linkColor: 'text-foreground hover:text-red-600 dark:hover:text-red-400',
  },
  resolved: {
    icon: '✓',
    label: 'Traités',
    color: 'text-emerald-600 dark:text-emerald-400',
    linkColor: 'text-foreground hover:text-emerald-600 dark:hover:text-emerald-400',
  },
  stillOpen: {
    icon: '→',
    label: 'Encore ouverts',
    color: 'text-muted-foreground',
    linkColor: 'text-muted-foreground hover:text-foreground',
  },
} as const

type FactKey = keyof typeof FACT_CONFIG

function FactGroup({
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
      <p className={cn('mb-1 text-xs font-semibold uppercase tracking-wide', cfg.color)}>
        <span aria-hidden className="mr-1">{cfg.icon}</span>
        {cfg.label} ({facts.length})
      </p>
      <ul className="space-y-0.5">
        {facts.map((fact) => {
          const tags: string[] = []
          if (fact.openActions > 0)  tags.push(`${fact.openActions} act.`)
          if (fact.openReserves > 0) tags.push(`${fact.openReserves} rés.`)
          if (fact.hasDeadlines)     tags.push('éch.')

          return (
            <li key={fact.canonicalSubjectId} className="flex items-start gap-1.5">
              <Link
                href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                className={cn(
                  'flex-1 truncate text-sm underline-offset-2 hover:underline',
                  cfg.linkColor,
                )}
              >
                {fact.label}
              </Link>
              {tags.length > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {tags.join(' · ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Carte d'une période ────────────────────────────────────────────────────────

function PeriodCard({
  period,
  narrativeText,
  siteId,
  index,
}: {
  period: EvolutionReadModel['periods'][number]
  narrativeText: string | null
  siteId: string
  index: number
}) {
  const pvLabel = period.pvNumbers.length === 0
    ? null
    : period.pvNumbers.length === 1
      ? `PV${period.pvNumbers[0]}`
      : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  const isMajor = !period.isSilence && period.importanceScore >= 24

  if (period.isSilence) {
    return (
      <div className={cn(
        'relative rounded-[18px] border border-dashed bg-muted/20 p-5',
        'flex flex-col gap-3',
      )}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Silence documentaire
          </p>
          <p className="mt-0.5 text-sm font-medium">
            {period.silenceDays ?? '?'} jours sans procès-verbal
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fmtShort(period.startDate)} — {fmtShort(period.endDate)}
          </p>
        </div>

        {period.stillOpen.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              → Sujets ouverts au début du silence ({period.stillOpen.length})
            </p>
            <ul className="space-y-0.5">
              {period.stillOpen.map((fact) => (
                <li key={fact.canonicalSubjectId}>
                  <Link
                    href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                    className="truncate text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {fact.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {narrativeText && (
          <p className="text-xs italic text-muted-foreground">{narrativeText}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'relative rounded-[18px] border bg-card p-5 shadow-sm',
      isMajor && 'border-foreground/20',
    )}>
      {/* En-tête */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Période {index + 1}
          </p>
          <p className="mt-0.5 text-base font-semibold">{period.label}</p>
          <p className="text-xs text-muted-foreground">
            {fmtShort(period.startDate)}
            {period.startDate !== period.endDate && ` — ${fmtShort(period.endDate)}`}
            {pvLabel && (
              <span className="ml-2 font-medium text-foreground">{pvLabel}</span>
            )}
          </p>
        </div>
        {isMajor && (
          <span className="shrink-0 rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Période clé
          </span>
        )}
      </div>

      {/* Faits */}
      <div className="space-y-3 divide-y divide-border">
        {(['appeared', 'aggravated', 'resolved', 'stillOpen'] as FactKey[]).map((key) => {
          const facts = period[key]
          if (facts.length === 0) return null
          return (
            <div key={key} className="pt-3 first:pt-0">
              <FactGroup kind={key} facts={facts} siteId={siteId} />
            </div>
          )
        })}
        {period.appeared.length === 0 && period.aggravated.length === 0 &&
         period.resolved.length === 0 && period.stillOpen.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun signal structurant détecté.</p>
        )}
      </div>

      {/* Narration */}
      {narrativeText && (
        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground italic">
          {narrativeText}
        </p>
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

  const narrativeByLabel = new Map(
    narrative.periods.map((p) => [p.periodLabel, p.text]),
  )

  return (
    <div className="space-y-4">
      {/* Résumé rapide */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{readModel.totalRuns}</span> PV analysés
          </span>
          {readModel.dateRange && (
            <span>
              {fmtShort(readModel.dateRange.start)} → {fmtShort(readModel.dateRange.end)}
            </span>
          )}
          <span>
            <span className="font-semibold text-foreground">
              {readModel.periods.filter((p) => !p.isSilence).length}
            </span> période{readModel.periods.filter((p) => !p.isSilence).length > 1 ? 's' : ''} active{readModel.periods.filter((p) => !p.isSilence).length > 1 ? 's' : ''}
          </span>
          {readModel.periods.some((p) => p.isSilence) && (
            <span className="text-muted-foreground">
              + {readModel.periods.filter((p) => p.isSilence).length} silence{readModel.periods.filter((p) => p.isSilence).length > 1 ? 's' : ''} documentaire{readModel.periods.filter((p) => p.isSilence).length > 1 ? 's' : ''}
            </span>
          )}
          {!narrative.deterministic && narrative.model && (
            <span className="text-xs text-muted-foreground/60">narration IA</span>
          )}
        </div>
      </section>

      {/* Périodes */}
      {readModel.periods.map((period, idx) => {
        const narrativeText = narrativeByLabel.get(period.label) ?? null
        const nonSilenceIdx = readModel.periods.slice(0, idx + 1).filter((p) => !p.isSilence).length
        const displayIndex  = period.isSilence ? nonSilenceIdx : nonSilenceIdx - 1

        return (
          <PeriodCard
            key={period.isSilence ? `silence-${idx}` : period.runIds?.[0] ?? idx}
            period={period}
            narrativeText={narrativeText}
            siteId={siteId}
            index={displayIndex}
          />
        )
      })}
    </div>
  )
}
