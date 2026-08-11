import Link from 'next/link'
import { cn } from '@/lib/utils'
import type {
  EvolutionReadModel,
  EvolutionNarrative,
  EvolutionSubjectFact,
} from '@/lib/documents/pv-evolution'
import type { SiteHealthTimeline } from '@/lib/documents/site-synthesis'
import type { NativeSubjectEvolution } from '@/lib/db/canonical-subject-life'
import type { V2SubjectResult, EvolutionV2Verdict } from '@/lib/knowledge/evolution-v2'

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
    return { type: 'silence', label: 'Silence documentaire', punchline: `${days} jours sans procès-verbal` }
  }

  const a = period.appeared.length
  const g = period.aggravated.length
  const r = period.resolved.length

  if (opts.isFirst && a > 0 && g === 0)
    return { type: 'start', label: 'Démarrage', punchline: a === 1 ? 'Premier sujet entre dans le suivi' : `${a} sujets entrent dans le suivi` }

  if (opts.prevWasSilence && (r > 0 || a > 0)) {
    const pts = [a > 0 ? `${a} nouveau${a > 1 ? 'x' : ''} sujet${a > 1 ? 's' : ''}` : null, r > 0 ? `${r} traitement${r > 1 ? 's' : ''}` : null].filter(Boolean)
    return { type: 'recovery', label: 'Reprise', punchline: pts.join(', ') }
  }

  if (a >= 4 && g >= 1) return { type: 'critical', label: 'Montée des difficultés', punchline: `${a} nouveaux sujets${g > 1 ? `, ${g} aggravations` : ', 1 aggravation'}` }
  if (a >= 3 && g === 0) return { type: 'neutral', label: 'Expansion du suivi', punchline: `${a} nouveaux sujets entrent dans le suivi` }
  if (g >= 2 && r === 0) return { type: 'critical', label: 'Phase critique', punchline: `${g} sujets s'aggravent ou rouvrent` }
  if (g >= 1 && r === 0 && a === 0) return { type: 'critical', label: 'Tensions', punchline: `${g} sujet${g > 1 ? 's aggravés' : ' aggravé'}, aucune résolution` }
  if (r >= 3 && g === 0 && a <= 1) return { type: 'resolution', label: 'Phase de résolution', punchline: `${r} sujets traités${a > 0 ? `, ${a} nouveau` : ''}` }
  if (r > 0 && g === 0 && a === 0) return { type: 'resolution', label: 'Avancement', punchline: `${r} sujet${r > 1 ? 's traités' : ' traité'}, pas de nouvelle difficulté` }
  if (a > 0 && r > 0 && g === 0) return { type: 'neutral', label: 'Évolution mixte', punchline: `${a} apparu${a > 1 ? 's' : ''}, ${r} traité${r > 1 ? 's' : ''}` }
  if (a === 0 && g === 0 && r === 0) return { type: 'stable', label: 'Stabilité', punchline: 'Aucune transition — sujets en cours' }

  return {
    type: 'neutral',
    label: 'Évolution',
    punchline: [a > 0 ? `${a} apparu${a > 1 ? 's' : ''}` : null, g > 0 ? `${g} aggravé${g > 1 ? 's' : ''}` : null, r > 0 ? `${r} traité${r > 1 ? 's' : ''}` : null].filter(Boolean).join(', ') || 'Sujets en cours',
  }
}

// ── Styles par type de phase ──────────────────────────────────────────────────

const PHASE_STYLES: Record<PhaseType, { dot: string; badge: string; cardBorder: string; bg: string }> = {
  start:      { dot: 'bg-blue-500 ring-blue-200 dark:ring-blue-900',     badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',       cardBorder: 'border-blue-200 dark:border-blue-900/60',     bg: 'bg-blue-50/30 dark:bg-blue-950/10' },
  critical:   { dot: 'bg-red-500 ring-red-200 dark:ring-red-900',        badge: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',            cardBorder: 'border-red-200 dark:border-red-900/60',       bg: 'bg-red-50/30 dark:bg-red-950/10' },
  resolution: { dot: 'bg-emerald-500 ring-emerald-200 dark:ring-emerald-900', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400', cardBorder: 'border-emerald-200 dark:border-emerald-900/60', bg: 'bg-emerald-50/20 dark:bg-emerald-950/10' },
  recovery:   { dot: 'bg-teal-500 ring-teal-200 dark:ring-teal-900',     badge: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',       cardBorder: 'border-teal-200 dark:border-teal-900/60',     bg: 'bg-teal-50/20 dark:bg-teal-950/10' },
  stable:     { dot: 'bg-slate-400 ring-slate-100 dark:ring-slate-800',  badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',   cardBorder: 'border-border',                               bg: '' },
  neutral:    { dot: 'bg-slate-500 ring-slate-100 dark:ring-slate-800',  badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',   cardBorder: 'border-border',                               bg: '' },
  silence:    { dot: 'bg-slate-300 dark:bg-slate-600 ring-slate-100 dark:ring-slate-800', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400', cardBorder: 'border-dashed border-border', bg: 'bg-muted/20' },
}

// ── Sélection des moments charnières ──────────────────────────────────────────

function selectCharnieres(
  periods: EvolutionReadModel['periods'],
  phases: PhaseInfo[],
): number[] {
  const nonSilenceScores = periods.filter((p) => !p.isSilence).map((p) => p.importanceScore)
  const maxScore = Math.max(...nonSilenceScores, 1)
  const threshold = Math.max(12, maxScore * 0.25)

  const selected = new Set<number>()

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    if (p.isSilence) {
      selected.add(i)
      continue
    }
    if (p.importanceScore >= threshold) selected.add(i)
    const prev = i > 0 ? periods[i - 1] : null
    if (prev?.isSilence) selected.add(i)  // toujours inclure la reprise après un silence
  }

  // Garantir au moins le score le plus élevé
  const topIdx = periods
    .map((p, i) => ({ i, score: p.isSilence ? 0 : p.importanceScore }))
    .sort((a, b) => b.score - a.score)[0]?.i
  if (topIdx !== undefined) selected.add(topIdx)

  return [...selected].sort((a, b) => a - b)
}

// ── Impact label ──────────────────────────────────────────────────────────────

function impactLabel(score: number, maxScore: number): string {
  const pct = score / Math.max(maxScore, 1)
  if (pct >= 0.7) return 'Impact très fort'
  if (pct >= 0.4) return 'Impact fort'
  if (pct >= 0.2) return 'Impact modéré'
  return 'Impact limité'
}

// ── Helpers date ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShortMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

// ── Courbe de tension (SVG pur) ────────────────────────────────────────────────

function TensionCurve({ timeline }: { timeline: SiteHealthTimeline }) {
  const { points, peakActive } = timeline
  if (points.length < 2) return null

  const W = 320, H = 55
  const PAD = { t: 10, r: 8, b: 18, l: 32 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const n = points.length

  const xOf = (i: number) => PAD.l + (i / (n - 1)) * plotW
  const yOf = (v: number) => PAD.t + plotH - (v / peakActive) * plotH

  const linePoints = points.map((p, i) => `${xOf(i)},${yOf(p.activeCount)}`).join(' ')
  const areaPoints = [
    `${xOf(0)},${PAD.t + plotH}`,
    ...points.map((p, i) => `${xOf(i)},${yOf(p.activeCount)}`),
    `${xOf(n - 1)},${PAD.t + plotH}`,
  ].join(' ')

  // Y grid lines : 0, peak/2, peak
  const gridValues = [0, Math.round(peakActive / 2), peakActive]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Courbe de tension du chantier">
      {/* Grid */}
      {gridValues.map((v) => (
        <line key={v}
          x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)}
          stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="3,2" />
      ))}
      {/* Area */}
      <polygon points={areaPoints} fill="#fed7aa" fillOpacity="0.5" />
      {/* Line */}
      <polyline points={linePoints} fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(p.activeCount)} r="2.5" fill="#f97316" />
      ))}
      {/* Y labels */}
      {gridValues.filter((v) => v > 0).map((v) => (
        <text key={v} x={PAD.l - 3} y={yOf(v) + 3} textAnchor="end" fontSize="7" fill="#9ca3af">{v}</text>
      ))}
      <text x={PAD.l - 3} y={PAD.t + plotH + 2} textAnchor="end" fontSize="7" fill="#9ca3af">0</text>
      {/* X labels : afficher au plus 9 labels */}
      {points.map((p, i) => {
        const step = Math.max(1, Math.floor(n / 9))
        if (i % step !== 0 && i !== n - 1) return null
        return (
          <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="7" fill="#9ca3af">
            PV{p.pvNumber}
          </text>
        )
      })}
    </svg>
  )
}

// ── Courbe de santé dérivée (SVG pur) ─────────────────────────────────────────

// ── Groupe de sujets dans une carte de période ────────────────────────────────

const FACT_CONFIG = {
  appeared:   { label: 'Entrent dans le suivi', linkColor: 'text-foreground/90 hover:text-foreground' },
  aggravated: { label: 'S\'aggravent ou rouvrent', linkColor: 'text-red-700 dark:text-red-400 hover:underline' },
  resolved:   { label: 'Sont traités',           linkColor: 'text-emerald-700 dark:text-emerald-400 hover:underline' },
  stillOpen:  { label: 'Restent actifs',          linkColor: 'text-muted-foreground hover:text-foreground' },
} as const

type FactKey = keyof typeof FACT_CONFIG

function SubjectList({
  kind, facts, siteId, subjectLabelMap,
}: {
  kind: FactKey
  facts: EvolutionSubjectFact[]
  siteId: string
  subjectLabelMap?: Record<string, string>
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
          const canonicalLabel = subjectLabelMap?.[fact.canonicalSubjectId]
          const showCanonical = canonicalLabel && canonicalLabel.toLowerCase().trim() !== fact.label.toLowerCase().trim()
          return (
            <li key={fact.canonicalSubjectId} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                  className={cn('block truncate text-sm underline-offset-2', cfg.linkColor)}>
                  {fact.label}
                </Link>
                {showCanonical && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    Sujet suivi · {canonicalLabel}
                  </p>
                )}
              </div>
              {tags.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">{tags.join(' · ')}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Carte charnière (compacte, au-dessus de la frise) ─────────────────────────

function CharnièreCard({
  period, phase, styles, siteId, maxScore,
}: {
  period: EvolutionReadModel['periods'][number]
  phase: PhaseInfo
  styles: (typeof PHASE_STYLES)[PhaseType]
  siteId: string
  maxScore: number
}) {
  const pvLabel = period.pvNumbers.length === 0 ? null
    : period.pvNumbers.length === 1 ? `PV${period.pvNumbers[0]}`
    : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  const impact = period.isSilence ? null : impactLabel(period.importanceScore, maxScore)

  return (
    <div className={cn('flex-1 min-w-0 rounded-[18px] border p-4 shadow-sm', styles.cardBorder, styles.bg || 'bg-card')}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', styles.badge)}>
          {phase.label}
        </span>
        {impact && (
          <span className="text-[11px] text-muted-foreground">{impact}</span>
        )}
      </div>
      <p className="text-sm font-semibold leading-snug">{phase.punchline}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {period.isSilence
          ? `${fmtDate(period.startDate)} → ${fmtDate(period.endDate)}`
          : fmtShortMonth(period.startDate)
        }
        {pvLabel && <span className="ml-1.5 font-medium text-foreground">{pvLabel}</span>}
      </p>

      {/* Sujets clés : compact */}
      {!period.isSilence && (period.appeared.length > 0 || period.aggravated.length > 0 || period.resolved.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {[...period.appeared, ...period.aggravated, ...period.resolved].slice(0, 4).map((fact) => (
            <Link key={fact.canonicalSubjectId}
              href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
              className="inline-flex max-w-[160px] truncate rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
              {fact.label}
            </Link>
          ))}
          {(period.appeared.length + period.aggravated.length + period.resolved.length) > 4 && (
            <span className="text-[11px] text-muted-foreground">+ {(period.appeared.length + period.aggravated.length + period.resolved.length) - 4}</span>
          )}
        </div>
      )}

      {period.isSilence && period.stillOpen.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {period.stillOpen.length} sujet{period.stillOpen.length > 1 ? 's' : ''} en attente
        </p>
      )}
    </div>
  )
}

// ── Carte détaillée (frise complète) ──────────────────────────────────────────

function SilenceCard({ period, styles, narrativeText, siteId }: {
  period: EvolutionReadModel['periods'][number]
  styles: (typeof PHASE_STYLES)[PhaseType]
  narrativeText: string | null
  siteId: string
}) {
  return (
    <div className={cn('rounded-[18px] border p-4', styles.cardBorder, styles.bg)}>
      <div>
        <p className="text-sm font-semibold">{period.silenceDays ?? '?'} jours sans procès-verbal</p>
        <p className="text-xs text-muted-foreground">{fmtDate(period.startDate)} → {fmtDate(period.endDate)}</p>
      </div>
      {period.stillOpen.length > 0 && (
        <div className="mt-3 border-t border-dashed border-border pt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sujets en attente pendant ce silence ({period.stillOpen.length})
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {period.stillOpen.map((fact) => (
              <li key={fact.canonicalSubjectId}>
                <Link href={`/sites/${siteId}/historique/sujets/${fact.canonicalSubjectId}`}
                  className="inline-flex items-center rounded-full bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground">
                  {fact.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {narrativeText && <p className="mt-3 text-xs italic text-muted-foreground">{narrativeText}</p>}
    </div>
  )
}

function PeriodCard({ period, phase, styles, narrativeText, siteId, subjectLabelMap }: {
  period: EvolutionReadModel['periods'][number]
  phase: PhaseInfo
  styles: (typeof PHASE_STYLES)[PhaseType]
  narrativeText: string | null
  siteId: string
  subjectLabelMap?: Record<string, string>
}) {
  const pvLabel = period.pvNumbers.length === 0 ? null
    : period.pvNumbers.length === 1 ? `PV${period.pvNumbers[0]}`
    : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  return (
    <div className={cn('rounded-[18px] border bg-card p-5 shadow-sm', styles.cardBorder, styles.bg)}>
      <div className="mb-1 flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', styles.badge)}>
          {phase.label}
        </span>
        {pvLabel && <span className="text-xs font-medium text-muted-foreground">{pvLabel}</span>}
      </div>
      <p className="text-base font-semibold leading-snug">{phase.punchline}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {period.startDate === period.endDate ? fmtDate(period.startDate) : fmtShortMonth(period.startDate)}
      </p>

      {narrativeText && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground italic">{narrativeText}</p>
      )}

      {(period.appeared.length > 0 || period.aggravated.length > 0 || period.resolved.length > 0 || period.stillOpen.length > 0) && (
        <div className={cn('mt-3 space-y-3 border-t border-border pt-3', narrativeText && 'mt-3')}>
          <SubjectList kind="appeared"   facts={period.appeared}   siteId={siteId} subjectLabelMap={subjectLabelMap} />
          <SubjectList kind="aggravated" facts={period.aggravated} siteId={siteId} subjectLabelMap={subjectLabelMap} />
          <SubjectList kind="resolved"   facts={period.resolved}   siteId={siteId} subjectLabelMap={subjectLabelMap} />
          <SubjectList kind="stillOpen"  facts={period.stillOpen}  siteId={siteId} subjectLabelMap={subjectLabelMap} />
        </div>
      )}
    </div>
  )
}

// ── Évolution native (visites terrain + réunions) ─────────────────────────────

const SOURCE_KIND_LABEL: Record<string, string> = {
  field_visit: 'Visite terrain',
  meeting: 'Réunion',
}

function fmtShortDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const VERDICT_CONFIG: Record<EvolutionV2Verdict, { label: string; className: string }> = {
  meaningful_change: { label: 'Évolution détectée', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  remention:         { label: 'Pas d\'évolution significative', className: 'bg-muted text-muted-foreground' },
  ambiguous:         { label: 'Ambigu', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
}

const PATTERN_LABEL: Record<string, string> = {
  status_transition:   'Changement de statut',
  scope_change:        'Périmètre redéfini',
  operationalization:  'Passage à la réalisation',
  new_fact:            'Fait nouveau',
}

function V2PairCard({ pair }: { pair: V2SubjectResult['pairs'][number] }) {
  const { stateT1, stateT2, result } = pair
  if (!result) return null

  const verdict = VERDICT_CONFIG[result.verdict]

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      {/* T1 */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {fmtShortDate(stateT1.date)} · {SOURCE_KIND_LABEL[stateT1.sourceKind] ?? stateT1.sourceKind}
          {stateT1.fallbackUsed && <span className="ml-1 text-amber-600">(fallback)</span>}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-foreground/80">{stateT1.state}</p>
      </div>

      {/* Verdict */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', verdict.className)}>
          {verdict.label}
        </span>
        {result.pattern && (
          <span className="text-[11px] text-muted-foreground">{PATTERN_LABEL[result.pattern] ?? result.pattern}</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">conf. {(result.confidence * 100).toFixed(0)}%</span>
      </div>

      {/* Justification */}
      {result.justification && (
        <p className="text-[11px] italic text-muted-foreground leading-snug border-l-2 border-border pl-2">
          {result.justification}
        </p>
      )}

      {/* T2 */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {fmtShortDate(stateT2.date)} · {SOURCE_KIND_LABEL[stateT2.sourceKind] ?? stateT2.sourceKind}
          {stateT2.fallbackUsed && <span className="ml-1 text-amber-600">(fallback)</span>}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-foreground/80">{stateT2.state}</p>
      </div>
    </div>
  )
}

function NativeEvolutionSection({
  subjects,
  siteId,
  v2Results,
}: {
  subjects: NativeSubjectEvolution[]
  siteId: string
  v2Results?: V2SubjectResult[]
}) {
  const v2BySubject = v2Results
    ? new Map(v2Results.map((r) => [r.canonicalSubjectId, r]))
    : null

  return (
    <section className="rounded-[22px] border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Évolution des sujets observés</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {subjects.length} sujet{subjects.length > 1 ? 's' : ''} avec au moins deux événements distincts · visites terrain &amp; réunions
          </p>
        </div>
        {v2BySubject && (
          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            Mode debug V2 · shadow
          </span>
        )}
      </div>
      <div className="space-y-6">
        {subjects.map((subject) => {
          const v2 = v2BySubject?.get(subject.canonicalSubjectId)
          return (
            <div key={subject.canonicalSubjectId}>
              <Link
                href={`/sites/${siteId}/historique/sujets/${subject.canonicalSubjectId}`}
                className="text-sm font-semibold hover:underline"
              >
                {subject.label}
              </Link>

              {/* V2 mode : paires consolidées */}
              {v2 && v2.pairs.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {v2.pairs.map((pair, i) => (
                    <V2PairCard key={i} pair={pair} />
                  ))}
                </div>
              ) : (
                /* Fallback : vue brute des événements */
                <ol className="mt-2 space-y-2 border-l border-border pl-4">
                  {subject.events.map((ev, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[1.125rem] top-[0.4rem] h-2 w-2 rounded-full border border-border bg-card" />
                      <p className="text-xs text-muted-foreground">
                        {fmtShortDate(ev.date)}
                        {' · '}
                        {SOURCE_KIND_LABEL[ev.sourceKind] ?? ev.sourceKind}
                      </p>
                      <p className="mt-0.5 text-sm leading-snug text-foreground/80">
                        {ev.labels.slice(0, 2).join(' · ')}
                        {ev.labels.length > 2 && (
                          <span className="text-muted-foreground"> +{ev.labels.length - 2}</span>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export interface EvolutionViewProps {
  siteId: string
  readModel: EvolutionReadModel
  narrative: EvolutionNarrative
  healthTimeline: SiteHealthTimeline | null
  nativeEvents?: Array<{ date: string; sourceKind: 'field_visit' | 'meeting'; label: string; canonicalSubjectId: string }>
  nativeSubjectEvolutions?: NativeSubjectEvolution[]
  v2Results?: V2SubjectResult[]
  subjectLabelMap?: Record<string, string>
}

export function EvolutionView({ siteId, readModel, narrative, healthTimeline, nativeEvents, nativeSubjectEvolutions, v2Results, subjectLabelMap }: EvolutionViewProps) {
  if (readModel.periods.length === 0) {
    if (nativeSubjectEvolutions && nativeSubjectEvolutions.length > 0) {
      return <NativeEvolutionSection subjects={nativeSubjectEvolutions} siteId={siteId} v2Results={v2Results} />
    }
    return (
      <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
        <p className="font-medium">Pas assez de données pour reconstituer l'évolution.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Un sujet canonique doit avoir au moins deux événements distincts dans le temps.
        </p>
      </section>
    )
  }

  const narrativeByLabel = new Map(narrative.periods.map((p) => [p.periodLabel, p.text]))

  // Précalcul des phases
  const phases: PhaseInfo[] = readModel.periods.map((period, idx) => {
    const prevWasSilence = idx > 0 ? readModel.periods[idx - 1].isSilence : false
    return computePhase(period, { isFirst: idx === 0, prevWasSilence })
  })

  const maxNonSilenceScore = Math.max(...readModel.periods.filter((p) => !p.isSilence).map((p) => p.importanceScore), 1)
  const charnièreIdxs = selectCharnieres(readModel.periods, phases)

  const activePeriods  = readModel.periods.filter((p) => !p.isSilence).length
  const silencePeriods = readModel.periods.filter((p) => p.isSilence).length

  return (
    <div className="space-y-4">
      {/* ── 1. MOMENTS CHARNIÈRES ────────────────────────────────────────── */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold">Moments qui ont changé ce chantier</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {readModel.totalRuns} PV · {activePeriods} période{activePeriods > 1 ? 's' : ''}
              {silencePeriods > 0 && ` · ${silencePeriods} silence${silencePeriods > 1 ? 's' : ''}`}
              {!narrative.deterministic && narrative.model && ' · narration IA'}
            </p>
          </div>
          {readModel.dateRange && (
            <p className="shrink-0 text-xs text-muted-foreground">
              {fmtDate(readModel.dateRange.start)} → {fmtDate(readModel.dateRange.end)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {charnièreIdxs.map((idx: number) => (
            <CharnièreCard
              key={idx}
              period={readModel.periods[idx]}
              phase={phases[idx]}
              styles={PHASE_STYLES[phases[idx].type]}
              siteId={siteId}
              maxScore={maxNonSilenceScore}
            />
          ))}
        </div>
      </section>

      {/* ── 2. COURBE DE TENSION ─────────────────────────────────────────── */}
      {healthTimeline && healthTimeline.points.length >= 2 && (() => {
        const pts       = healthTimeline.points
        const peak      = healthTimeline.peakActive
        const current   = pts[pts.length - 1].activeCount
        const peakPv    = pts.find((p) => p.activeCount === peak)?.pvNumber ?? '?'
        const deltaPct  = peak > 0 ? Math.round((peak - current) / peak * 100) : 0
        const deltaText = current < peak
          ? `−${deltaPct} % depuis le pic`
          : current === peak
            ? 'au niveau du pic'
            : `+${Math.round((current - peak) / peak * 100)} % au-dessus du pic`
        return (
          <section className="rounded-[22px] border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tension du chantier</p>
              <p className="shrink-0 text-right text-xs text-muted-foreground">
                Pic : <span className="font-medium text-foreground">{peak}</span> sujets au PV{peakPv}
                {' · '}Au dernier PV : <span className="font-medium text-foreground">{current}</span>
                {' · '}{deltaText}
              </p>
            </div>
            <div className="mt-3">
              <TensionCurve timeline={healthTimeline} />
            </div>
          </section>
        )
      })()}

      {/* ── 3. FRISE COMPLÈTE ────────────────────────────────────────────── */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chronique complète
        </p>

        <div className="relative">
          <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden />
          <div className="space-y-3">
            {readModel.periods.map((period, idx) => {
              const phase  = phases[idx]
              const styles = PHASE_STYLES[phase.type]
              const narrativeText = narrativeByLabel.get(period.label) ?? null

              return (
                <div key={period.isSilence ? `silence-${idx}` : period.runIds?.[0] ?? idx}
                     className="relative pl-6">
                  <div className={cn(
                    'absolute left-0 top-4 h-3.5 w-3.5 rounded-full ring-2 ring-background',
                    styles.dot,
                    period.isSilence && 'border-2 border-dashed border-slate-300 dark:border-slate-600 bg-background ring-0',
                  )} aria-hidden />

                  {period.isSilence ? (
                    <SilenceCard period={period} styles={styles} narrativeText={narrativeText} siteId={siteId} />
                  ) : (
                    <PeriodCard period={period} phase={phase} styles={styles} narrativeText={narrativeText} siteId={siteId} subjectLabelMap={subjectLabelMap} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── 4. ACTIVITÉ NATIVE POST-DERNIER PV ──────────────────────────── */}
      {nativeEvents && nativeEvents.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Activité native depuis le dernier PV
          </p>
          <div className="space-y-2">
            {nativeEvents.map((ev, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={cn(
                  'mt-0.5 shrink-0 text-xs font-medium',
                  ev.sourceKind === 'field_visit' ? 'text-teal-600 dark:text-teal-400' : 'text-violet-600 dark:text-violet-400',
                )}>
                  {ev.sourceKind === 'field_visit' ? '✓' : '◇'}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ev.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' · '}
                    {ev.sourceKind === 'field_visit' ? 'Visite terrain' : 'Réunion'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
