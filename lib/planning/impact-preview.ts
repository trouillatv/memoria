// DOC-CONTRACT-OS-1B4-C1 — aperçus READ-ONLY des 3 mutations Planning
// (NEW/MODIFY/SUSPEND), tous construits EXCLUSIVEMENT sur le moteur de
// projection existant (mandat §11 : « pas de second moteur de récurrence »).
// AUCUNE écriture — ni ici, ni chez l'appelant à ce stade : ce sont des
// PRÉVISUALISATIONS, jamais une matérialisation.

import { projectOccurrences, occurrenceKey, type ProjectableTemplate } from './projection'
import { previewCycle, type DraftCycle, type PreviewResult } from './cycle-preview'
import type { ProjectableClosure } from './closures'
import type { InterventionFrequency, InterventionSlot } from '@/types/db'

// ── NEW — virtual SIMPLE template, zéro cycle, zéro persistance (mandat §9) ──

export type DraftSimpleTemplate = {
  missionId: string
  frequency: InterventionFrequency
  slots: InterventionSlot[] | null
  dayOfWeek: number | null
  dayOfMonth: number | null
  plannedStartHHMM: string | null
  plannedEndHHMM: string | null
  startsOn: string
  endsOn: string | null
}

/** Projette un unique rythme SIMPLE virtuel — jamais écrit, jamais un cycle
 *  (cycle_length_weeks/anchor_date/week_index absents du template projeté). */
export function previewNewSimple(params: { draft: DraftSimpleTemplate; from: string; to: string }) {
  const { draft, from, to } = params
  const template: ProjectableTemplate = {
    id: 'draft-new-simple',
    mission_id: draft.missionId,
    frequency: draft.frequency,
    slots: draft.slots,
    day_of_week: draft.dayOfWeek,
    day_of_month: draft.dayOfMonth,
    planned_start_hhmm: draft.plannedStartHHMM,
    planned_end_hhmm: draft.plannedEndHHMM,
    starts_on: draft.startsOn,
    ends_on: draft.endsOn,
  }
  return projectOccurrences({ templates: [template], from, to })
}

// ── MODIFY (ROULEMENT) — grille avant/après, réutilise previewCycle (mandat §8/§11) ──

export type ModifyCycleGridPreview = {
  before: PreviewResult
  after: PreviewResult
}

export function previewModifyCycleGrid(params: {
  before: DraftCycle
  after: DraftCycle
  closures: ProjectableClosure[]
  from: string
  to: string
}): ModifyCycleGridPreview {
  const { before, after, closures, from, to } = params
  return {
    before: previewCycle({ cycle: before, closures, from, to }),
    after: previewCycle({ cycle: after, closures, from, to }),
  }
}

// ── SUSPEND — fenêtre d'exception, READ-ONLY strict (mandat §10) ────────────
//
// Ne matérialise JAMAIS toute la fenêtre pour pouvoir la « skip » ensuite :
// on se contente de CLASSER les occurrences projetées entre celles déjà
// matérialisées (une ligne `interventions` existe — `markInterventionSkipped`
// pourra s'y appliquer INDIVIDUELLEMENT, hors C1) et celles encore purement
// projetées (au-delà du cap de matérialisation glissant — cf.
// lib/planning/projection.ts, doctrine de tête) : aucune action n'est
// possible sur ces dernières tant que la génération ne les a pas rattrapées.
//
// `materializedOccurrenceKeys` est fourni par l'appelant (lib/db) — construit
// depuis de VRAIES lignes `interventions` déjà en base, via `occurrenceKey()`
// (même clé que l'index unique partiel, mig 021). Ce module reste pur : il ne
// connaît ni la date du jour, ni la base — seulement la classification.

export type SuspendOccurrencePreview = {
  templateId: string
  missionId: string
  scheduledFor: string
  slot: InterventionSlot | null
  materialized: boolean
  /** = materialized en C1 : seule une occurrence déjà matérialisée est
   *  individuellement « skippable » aujourd'hui (mandat §10). */
  skippable: boolean
}

export type SuspendWindowPreview = {
  occurrences: SuspendOccurrencePreview[]
  summary: {
    totalOccurrences: number
    materializedCount: number
    projectedOnlyCount: number
  }
}

export function previewSuspendWindow(params: {
  templates: ProjectableTemplate[]
  materializedOccurrenceKeys: ReadonlySet<string>
  from: string
  to: string
}): SuspendWindowPreview {
  const { templates, materializedOccurrenceKeys, from, to } = params
  const projected = projectOccurrences({ templates, from, to })

  const occurrences: SuspendOccurrencePreview[] = projected.map((o) => {
    const materialized = materializedOccurrenceKeys.has(occurrenceKey(o))
    return {
      templateId: o.templateId,
      missionId: o.missionId,
      scheduledFor: o.scheduledFor,
      slot: o.slot,
      materialized,
      skippable: materialized,
    }
  })

  const materializedCount = occurrences.filter((o) => o.materialized).length
  return {
    occurrences,
    summary: {
      totalOccurrences: occurrences.length,
      materializedCount,
      projectedOnlyCount: occurrences.length - materializedCount,
    },
  }
}
