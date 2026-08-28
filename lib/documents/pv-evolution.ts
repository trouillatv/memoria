import 'server-only'
import { z } from 'zod'
import { buildOccurrenceActivityMap } from './occurrence-population'
import type { ActivityMap, ActivityCellState } from './site-synthesis'

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
  silenceDays?: number          // nb de jours de silence documentaire

  // Événements pendant la période (transitions) — P0 : réouvert ≠ aggravé (jamais fusionnés).
  appeared: EvolutionSubjectFact[]    // première apparition dans ce chantier
  reopened: EvolutionSubjectFact[]    // résolu précédemment → rouvert
  aggravated: EvolutionSubjectFact[]  // aggravé (non-conforme) — distinct d'une réouverture
  resolved: EvolutionSubjectFact[]    // traité/clos pour la première fois dans cette période

  // État en fin de période (distinct des transitions)
  stillOpen: EvolutionSubjectFact[]   // encore ouvert à la fin de la période, sans transition notable

  importanceScore: number
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

const SILENCE_THRESHOLD_DAYS = 45  // gap > 45j → période de silence documentaire

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

/** Dernier état connu (non absent) d'une cellule jusqu'à l'indice upToIdx inclus. */
function lastKnownCellState(cells: ActivityCellState[], upToIdx: number): ActivityCellState {
  for (let i = Math.min(upToIdx, cells.length - 1); i >= 0; i--) {
    if (cells[i] !== 'absent') return cells[i]
  }
  return 'absent'
}

/** Vrai si l'état représente un sujet encore ouvert (non clos). */
function isOpenState(state: ActivityCellState): boolean {
  return state === 'first' || state === 'open' || state === 'non_compliant' || state === 'reopened'
}

// ── Détection des périodes ────────────────────────────────────────────────────

interface RunEntry { id: string; effectiveDate: string; pvNumber: number }

interface RawGroup {
  runs: RunEntry[]
  isSilence: boolean
  silenceDays?: number
  silenceStart?: string
  silenceEnd?: string
}

/**
 * Regroupe les PV par mois calendaire.
 * Un gap > SILENCE_THRESHOLD_DAYS insère une période de silence documentaire.
 */
function groupRunsIntoPeriods(runs: RunEntry[]): RawGroup[] {
  if (runs.length === 0) return []

  const groups: RawGroup[] = []
  let current: RunEntry[] = [runs[0]]
  let currentMonth = runs[0].effectiveDate.slice(0, 7)  // YYYY-MM

  for (let i = 1; i < runs.length; i++) {
    const gap      = daysBetween(runs[i - 1].effectiveDate, runs[i].effectiveDate)
    const runMonth = runs[i].effectiveDate.slice(0, 7)

    if (gap > SILENCE_THRESHOLD_DAYS) {
      groups.push({ runs: current, isSilence: false })
      const after  = new Date(runs[i - 1].effectiveDate)
      const before = new Date(runs[i].effectiveDate)
      after.setDate(after.getDate() + 1)
      before.setDate(before.getDate() - 1)
      groups.push({
        runs: [],
        isSilence: true,
        silenceDays: gap,
        silenceStart: after.toISOString().slice(0, 10),
        silenceEnd:   before.toISOString().slice(0, 10),
      })
      current      = [runs[i]]
      currentMonth = runMonth
    } else if (runMonth !== currentMonth) {
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

/**
 * @param group          Groupe de PV (ou silence)
 * @param activityMap    Grille complète runs × sujets
 * @param lastKnownIdx   Index global du dernier run dont on connaît l'état
 *                       (= dernier run du groupe pour les périodes normales,
 *                        = dernier run avant le silence pour les périodes de silence)
 */
function computePeriodFacts(
  group: RawGroup,
  activityMap: ActivityMap,
  lastKnownIdx: number,
): EvolutionPeriod {
  if (group.isSilence) {
    // Pour le silence : sujets encore ouverts au moment où il débute
    const stillOpen: EvolutionSubjectFact[] = []
    for (const row of activityMap.rows) {
      const last = lastKnownCellState(
        row.cells.map((c) => c.state),
        lastKnownIdx,
      )
      if (isOpenState(last)) {
        stillOpen.push({
          canonicalSubjectId: row.canonicalSubjectId,
          label:       row.label,
          hasActions:  row.hasActions,
          hasReserves: row.hasReserves,
          hasDecisions: row.hasDecisions,
          hasDeadlines: row.hasDeadlines,
          openActions:  row.openActions,
          openReserves: row.openReserves,
        })
      }
    }

    return {
      label:     buildPeriodLabel(group.silenceStart!, group.silenceEnd!, true),
      startDate: group.silenceStart!,
      endDate:   group.silenceEnd!,
      pvNumbers: [],
      runIds:    [],
      isSilence: true,
      silenceDays: group.silenceDays,
      appeared:  [],
      reopened:  [],
      aggravated: [],
      resolved:  [],
      stillOpen,
      importanceScore: 2,
    }
  }

  const runToIdx   = new Map(activityMap.runs.map((r, i) => [r.id, i]))
  const periodIdxs = group.runs.map((r) => runToIdx.get(r.id) ?? -1).filter((i) => i >= 0)
  const firstPeriodIdx = periodIdxs[0] ?? 0

  const appeared:  EvolutionSubjectFact[] = []
  const reopened:  EvolutionSubjectFact[] = []
  const aggravated: EvolutionSubjectFact[] = []
  const resolved:  EvolutionSubjectFact[] = []
  const stillOpen: EvolutionSubjectFact[] = []

  for (const row of activityMap.rows) {
    const rawCells   = row.cells.map((c) => c.state)
    const periodCells = periodIdxs.map((i) => rawCells[i] ?? 'absent')
    if (periodCells.every((s) => s === 'absent')) continue

    const isFirst = periodCells.includes('first')
    // P0 : réouvert ≠ aggravé. Réouverture prioritaire sur non-conformité.
    const isReopened = periodCells.some((s) => s === 'reopened')
    const isAggr  = periodCells.some((s) => s === 'non_compliant')

    // État juste avant la période (pour détecter les "nouvellement résolus")
    const preState = firstPeriodIdx > 0 ? lastKnownCellState(rawCells, firstPeriodIdx - 1) : 'absent'
    // Un sujet est "nouvellement résolu" s'il était ouvert avant la période et passe à done
    const isDone = !isFirst && !isReopened && !isAggr && periodCells.includes('done') && preState !== 'done'

    // État en fin de période
    const lastState = lastKnownCellState(rawCells, lastKnownIdx)
    const isOpenEnd = isOpenState(lastState)

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

    if (isFirst)         appeared.push(fact)
    else if (isReopened) reopened.push(fact)
    else if (isAggr)     aggravated.push(fact)
    else if (isDone)     resolved.push(fact)

    // Reste ouvert : aucune transition notable et encore ouvert en fin de période
    if (!isFirst && !isReopened && !isAggr && !isDone && isOpenEnd) stillOpen.push(fact)
  }

  // Score d'importance de la période
  const importanceScore =
    appeared.length  * 8 +
    reopened.length  * 6 +
    aggravated.length * 6 +
    resolved.length  * 3 +
    stillOpen.length * 1

  return {
    label:     buildPeriodLabel(group.runs[0].effectiveDate, group.runs[group.runs.length - 1].effectiveDate),
    startDate: group.runs[0].effectiveDate,
    endDate:   group.runs[group.runs.length - 1].effectiveDate,
    pvNumbers: group.runs.map((r) => r.pvNumber),
    runIds:    group.runs.map((r) => r.id),
    isSilence: false,
    appeared,
    reopened,
    aggravated,
    resolved,
    stillOpen,
    importanceScore,
  }
}

// ── Fonction serveur principale ───────────────────────────────────────────────

export async function buildEvolutionReadModel(siteId: string): Promise<EvolutionReadModel> {
  const activityMap = await buildOccurrenceActivityMap(siteId)

  if (activityMap.runs.length === 0) {
    return { siteId, totalRuns: 0, dateRange: null, periods: [] }
  }

  const groups = groupRunsIntoPeriods(activityMap.runs)
  const runToIdx = new Map(activityMap.runs.map((r, i) => [r.id, i]))

  let lastNonSilenceRunIdx = -1
  const periods: EvolutionPeriod[] = []

  for (const group of groups) {
    if (group.isSilence) {
      periods.push(computePeriodFacts(group, activityMap, lastNonSilenceRunIdx))
    } else {
      const lastRun = group.runs[group.runs.length - 1]
      const idx     = runToIdx.get(lastRun.id) ?? -1
      periods.push(computePeriodFacts(group, activityMap, idx))
      if (idx >= 0) lastNonSilenceRunIdx = idx
    }
  }

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
  if (period.isSilence) {
    const days = period.silenceDays ? `${period.silenceDays} jours` : 'une longue période'
    return `${days} sans procès-verbal. Les sujets ouverts continuent d'exister, mais leur évolution reste inconnue.`
  }

  const pvLabel = period.pvNumbers.length === 1
    ? `PV${period.pvNumbers[0]}`
    : `PV${period.pvNumbers[0]}–${period.pvNumbers[period.pvNumbers.length - 1]}`

  const parts: string[] = []

  if (period.appeared.length > 0) {
    const names = period.appeared.slice(0, 3).map((s) => s.label).join(', ')
    const more  = period.appeared.length > 3 ? ` et ${period.appeared.length - 3} autre(s)` : ''
    parts.push(`${period.appeared.length} sujet(s) apparu(s) : ${names}${more}.`)
  }
  if (period.reopened.length > 0) {
    const names = period.reopened.slice(0, 2).map((s) => s.label).join(', ')
    parts.push(`${period.reopened.length} sujet(s) rouvert(s) : ${names}.`)
  }
  if (period.aggravated.length > 0) {
    const names = period.aggravated.slice(0, 2).map((s) => s.label).join(', ')
    parts.push(`${period.aggravated.length} aggravé(s) : ${names}.`)
  }
  if (period.resolved.length > 0) {
    parts.push(`${period.resolved.length} sujet(s) traité(s).`)
  }
  if (period.stillOpen.length > 0) {
    parts.push(`${period.stillOpen.length} sujet(s) encore ouvert(s).`)
  }
  if (parts.length === 0) parts.push('Aucun signal structurant.')

  return `${pvLabel} — ${parts.join(' ')}`
}

const narrativeSchema = z.object({
  periods: z.array(z.object({
    periodLabel:          z.string(),
    text:                 z.string().min(10).max(600),
    supportingSubjectIds: z.array(z.string()),
  })).max(10),
})

const NARRATIVE_SYSTEM = `Tu es un analyste chantier. Tu produis une narration historique courte et factuelle
à partir de données structurées sur l'évolution d'un chantier de construction.

Règles absolues :
- Tu n'affirmes QUE ce que les données te donnent explicitement.
- Absence de mention dans un PV ≠ résolution — ne conclus jamais qu'un sujet est clos sans le voir dans les données.
- Pas de causalité implicite entre sujets différents.
- Pas de jugement sur des personnes ou entreprises.
- 2 à 4 phrases par période normale, sobres, concrètes, en français.
- Pour une période de silence : 1 seule phrase factuelle mentionnant le nombre de jours.
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
      lines.push(`${p.silenceDays ?? '?'} jours sans procès-verbal.`)
      if (p.stillOpen.length > 0) {
        lines.push(`Sujets toujours ouverts au début du silence :`)
        for (const s of p.stillOpen) lines.push(`  [${s.canonicalSubjectId}] ${s.label}`)
      }
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

    if (p.stillOpen.length > 0) {
      lines.push(`Encore ouverts (${p.stillOpen.length}) :`)
      for (const s of p.stillOpen) {
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
      maxOutputTokens: 2500,
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
