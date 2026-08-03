import 'server-only'
import { z } from 'zod'
import { getActivityMap } from './site-synthesis'
import type { ActivityMap } from './site-synthesis'

// ── Types publics ─────────────────────────────────────────────────────────────

export interface EvolutionSubjectFact {
  canonicalSubjectId: string
  label: string
  hasActions: boolean
  hasReserves: boolean
  hasDecisions: boolean
  hasDeadlines: boolean
  openActions: number
  openReserves: number
}

export interface EvolutionPeriod {
  label: string
  startDate: string
  endDate: string
  pvNumbers: number[]
  runIds: string[]
  isSilence: boolean

  appeared: EvolutionSubjectFact[]
  aggravated: EvolutionSubjectFact[]
  resolved: EvolutionSubjectFact[]
  persistent: EvolutionSubjectFact[]
}

export interface EvolutionReadModel {
  siteId: string
  totalRuns: number
  dateRange: { start: string; end: string } | null
  periods: EvolutionPeriod[]
}

export interface EvolutionPeriodNarrative {
  periodLabel: string
  text: string
  supportingSubjectIds: string[]
}

export interface EvolutionNarrative {
  periods: EvolutionPeriodNarrative[]
  model: string | null
  deterministic: boolean
}

// ── Constantes ────────────────────────────────────────────────────────────────

const GAP_THRESHOLD_DAYS = 35      // gap > 35j → nouvelle période
const SILENCE_THRESHOLD_DAYS = 45  // gap > 45j → insérer une période de silence documentaire

// ── Helpers purs ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long' })
}

function buildPeriodLabel(startDate: string, endDate: string, isSilence = false): string {
  const sMonth = monthLabel(startDate)
  const eMonth = monthLabel(endDate)
  const sYear  = new Date(startDate).getFullYear()
  const eYear  = new Date(endDate).getFullYear()

  let range: string
  if (sYear === eYear) {
    range = sMonth === eMonth
      ? `${capitalize(sMonth)} ${sYear}`
      : `${capitalize(sMonth)}–${eMonth} ${sYear}`
  } else {
    range = `${capitalize(sMonth)} ${sYear}–${eMonth} ${eYear}`
  }

  return isSilence ? `Silence documentaire — ${range}` : range
}

// ── Détection des périodes ────────────────────────────────────────────────────

interface RunEntry { id: string; effectiveDate: string; pvNumber: number }

interface RawGroup {
  runs: RunEntry[]
  isSilence: boolean
  silenceStart?: string
  silenceEnd?: string
}

function groupRunsIntoPeriods(runs: RunEntry[]): RawGroup[] {
  if (runs.length === 0) return []

  const groups: RawGroup[] = []
  let current: RunEntry[] = [runs[0]]
  let currentMonth = runs[0].effectiveDate.slice(0, 7)  // YYYY-MM

  for (let i = 1; i < runs.length; i++) {
    const gap      = daysBetween(runs[i - 1].effectiveDate, runs[i].effectiveDate)
    const runMonth = runs[i].effectiveDate.slice(0, 7)

    if (gap > SILENCE_THRESHOLD_DAYS) {
      // Silence documentaire
      groups.push({ runs: current, isSilence: false })
      const after  = new Date(runs[i - 1].effectiveDate)
      const before = new Date(runs[i].effectiveDate)
      after.setDate(after.getDate() + 1)
      before.setDate(before.getDate() - 1)
      groups.push({
        runs: [],
        isSilence: true,
        silenceStart: after.toISOString().slice(0, 10),
        silenceEnd:   before.toISOString().slice(0, 10),
      })
      current      = [runs[i]]
      currentMonth = runMonth
    } else if (runMonth !== currentMonth) {
      // Changement de mois calendaire → nouvelle période
      groups.push({ runs: current, isSilence: false })
      current      = [runs[i]]
      currentMonth = runMonth
    } else {
      current.push(runs[i])
    }
  }
  groups.push({ runs: current, isSilence: false })
  return groups
}

// ── Calcul des faits par période ──────────────────────────────────────────────

function computePeriodFacts(group: RawGroup, activityMap: ActivityMap): EvolutionPeriod {
  if (group.isSilence) {
    return {
      label:     buildPeriodLabel(group.silenceStart!, group.silenceEnd!, true),
      startDate: group.silenceStart!,
      endDate:   group.silenceEnd!,
      pvNumbers: [],
      runIds:    [],
      isSilence: true,
      appeared:  [],
      aggravated: [],
      resolved:  [],
      persistent: [],
    }
  }

  const runToIdx   = new Map(activityMap.runs.map((r, i) => [r.id, i]))
  const periodIdxs = group.runs.map((r) => runToIdx.get(r.id) ?? -1).filter((i) => i >= 0)

  const startDate = group.runs[0].effectiveDate
  const endDate   = group.runs[group.runs.length - 1].effectiveDate

  const appeared:  EvolutionSubjectFact[] = []
  const aggravated: EvolutionSubjectFact[] = []
  const resolved:  EvolutionSubjectFact[] = []
  const persistent: EvolutionSubjectFact[] = []

  for (const row of activityMap.rows) {
    const periodCells = periodIdxs.map((i) => row.cells[i]).filter(Boolean)
    if (periodCells.length === 0) continue

    const states    = periodCells.map((c) => c.state)
    const isFirst   = states.includes('first')
    const isAggr    = states.some((s) => s === 'non_compliant' || s === 'reopened')
    const isDone    = !isFirst && !isAggr && states.includes('done')
    const openCount = states.filter((s) => s === 'open').length

    const fact: EvolutionSubjectFact = {
      canonicalSubjectId: row.canonicalSubjectId,
      label:       row.label,
      hasActions:  row.hasActions,
      hasReserves: row.hasReserves,
      hasDecisions: row.hasDecisions,
      hasDeadlines: row.hasDeadlines,
      openActions:  row.openActions,
      openReserves: row.openReserves,
    }

    if (isFirst)    appeared.push(fact)
    if (isAggr)     aggravated.push(fact)
    if (isDone && !isFirst && !isAggr) resolved.push(fact)
    if (!isFirst && !isAggr && !isDone && openCount >= 2) persistent.push(fact)
  }

  return {
    label: buildPeriodLabel(startDate, endDate),
    startDate,
    endDate,
    pvNumbers: group.runs.map((r) => r.pvNumber),
    runIds:    group.runs.map((r) => r.id),
    isSilence: false,
    appeared,
    aggravated,
    resolved,
    persistent,
  }
}

// ── Fonction serveur principale ───────────────────────────────────────────────

export async function buildEvolutionReadModel(siteId: string): Promise<EvolutionReadModel> {
  const activityMap = await getActivityMap(siteId)

  if (activityMap.runs.length === 0) {
    return { siteId, totalRuns: 0, dateRange: null, periods: [] }
  }

  const groups  = groupRunsIntoPeriods(activityMap.runs)
  const periods = groups.map((g) => computePeriodFacts(g, activityMap))

  return {
    siteId,
    totalRuns: activityMap.runs.length,
    dateRange: {
      start: activityMap.runs[0].effectiveDate,
      end:   activityMap.runs[activityMap.runs.length - 1].effectiveDate,
    },
    periods,
  }
}

// ── Narration ─────────────────────────────────────────────────────────────────

function buildDeterministicText(period: EvolutionPeriod): string {
  if (period.isSilence) return 'Aucun PV sur cette période — aucune observation documentée.'

  const pvLabel = period.pvNumbers.length === 1
    ? `PV${period.pvNumbers[0]}`
    : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  const parts: string[] = []

  if (period.appeared.length > 0) {
    const names = period.appeared.slice(0, 3).map((s) => s.label).join(', ')
    const more  = period.appeared.length > 3 ? ` et ${period.appeared.length - 3} autre(s)` : ''
    parts.push(`${period.appeared.length} sujet(s) apparu(s) : ${names}${more}.`)
  }
  if (period.aggravated.length > 0) {
    const names = period.aggravated.slice(0, 2).map((s) => s.label).join(', ')
    parts.push(`${period.aggravated.length} aggravé(s)/réouvert(s) : ${names}.`)
  }
  if (period.resolved.length > 0) {
    parts.push(`${period.resolved.length} sujet(s) traité(s).`)
  }
  if (period.persistent.length > 0) {
    parts.push(`${period.persistent.length} sujet(s) persistant(s).`)
  }
  if (parts.length === 0) parts.push('Aucun signal structurant.')

  return `${pvLabel} — ${parts.join(' ')}`
}

const narrativeSchema = z.object({
  periods: z.array(z.object({
    periodLabel:          z.string(),
    text:                 z.string().min(10).max(600),
    supportingSubjectIds: z.array(z.string()),
  })).max(8),
})

const NARRATIVE_SYSTEM = `Tu es un analyste chantier. Tu produis une narration historique courte et factuelle
à partir de données structurées sur l'évolution d'un chantier de construction.

Règles absolues :
- Tu n'affirmes QUE ce que les données te donnent explicitement.
- Absence de mention dans un PV ≠ résolution — ne conclus jamais qu'un sujet est clos sans le voir dans les données.
- Pas de causalité implicite entre sujets différents.
- Pas de jugement sur des personnes ou entreprises.
- 2 à 4 phrases par période, sobres, concrètes, en français.
- Pour une période de silence, une seule phrase courte.
- Dans supportingSubjectIds, liste uniquement les canonicalSubjectIds des sujets nommés dans le texte.`

function buildNarrativePrompt(model: EvolutionReadModel): string {
  const lines: string[] = [
    `Chantier ID : ${model.siteId}`,
    `PV analysés : ${model.totalRuns}`,
    '',
  ]

  for (const p of model.periods) {
    lines.push(`=== ${p.label} ===`)

    if (p.isSilence) {
      lines.push('Aucun PV sur cette période.')
      lines.push('')
      continue
    }

    lines.push(`PV inclus : ${p.pvNumbers.map((n) => `PV${n}`).join(', ')}`)

    if (p.appeared.length > 0) {
      lines.push(`Apparus (${p.appeared.length}) :`)
      for (const s of p.appeared) {
        const flags = [
          s.hasActions   ? 'actions'   : null,
          s.hasReserves  ? 'réserves'  : null,
          s.hasDecisions ? 'décisions' : null,
          s.hasDeadlines ? 'échéances' : null,
        ].filter(Boolean).join(', ')
        lines.push(`  [${s.canonicalSubjectId}] ${s.label}${flags ? ` (${flags})` : ''}`)
      }
    }

    if (p.aggravated.length > 0) {
      lines.push(`Aggravés/réouverts (${p.aggravated.length}) :`)
      for (const s of p.aggravated) {
        const work = [
          s.openActions  > 0 ? `${s.openActions} action(s)` : null,
          s.openReserves > 0 ? `${s.openReserves} réserve(s)` : null,
        ].filter(Boolean).join(', ')
        lines.push(`  [${s.canonicalSubjectId}] ${s.label}${work ? ` — ${work}` : ''}`)
      }
    }

    if (p.resolved.length > 0) {
      lines.push(`Traités (${p.resolved.length}) :`)
      for (const s of p.resolved) lines.push(`  [${s.canonicalSubjectId}] ${s.label}`)
    }

    if (p.persistent.length > 0) {
      lines.push(`Persistants (${p.persistent.length}) :`)
      for (const s of p.persistent) {
        const work = [
          s.openActions  > 0 ? `${s.openActions} action(s)` : null,
          s.openReserves > 0 ? `${s.openReserves} réserve(s)` : null,
        ].filter(Boolean).join(', ')
        lines.push(`  [${s.canonicalSubjectId}] ${s.label}${work ? ` — ${work}` : ''}`)
      }
    }

    lines.push('')
  }

  lines.push('Produis la narration en JSON.')
  return lines.join('\n')
}

export async function generateEvolutionNarrative(
  readModel: EvolutionReadModel,
): Promise<EvolutionNarrative> {
  const fallback: EvolutionNarrative = {
    deterministic: true,
    model: null,
    periods: readModel.periods.map((p) => ({
      periodLabel:          p.label,
      text:                 buildDeterministicText(p),
      supportingSubjectIds: [
        ...p.appeared.map((s) => s.canonicalSubjectId),
        ...p.aggravated.map((s) => s.canonicalSubjectId),
      ],
    })),
  }

  if (readModel.periods.length === 0) return fallback

  try {
    const { getAIProvider } = await import('@/services/ai/factory')
    const provider = getAIProvider()
    if (provider.name === 'mock') return fallback

    const res = await provider.complete({
      systemPrompt:    NARRATIVE_SYSTEM,
      userMessage:     buildNarrativePrompt(readModel),
      responseSchema:  narrativeSchema,
      modelTier:       'light',
      maxOutputTokens: 2000,
    })

    let parsed: z.infer<typeof narrativeSchema> | undefined
    if (res.parsed) {
      const r = narrativeSchema.safeParse(res.parsed)
      if (r.success) parsed = r.data
    }
    if (!parsed) {
      try { parsed = narrativeSchema.parse(JSON.parse(res.text)) } catch { /* ignore */ }
    }

    if (!parsed) return fallback

    return { deterministic: false, model: res.model, periods: parsed.periods }
  } catch {
    return fallback
  }
}
