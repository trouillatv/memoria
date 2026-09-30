// DOC-CONTRACT-OS-1B4-C1 (mandat §15) — aperçus READ-ONLY NEW/MODIFY/SUSPEND,
// tous construits sur le moteur de projection existant (mandat §11). Aucune
// de ces fonctions n'écrit quoi que ce soit — on vérifie ici la forme des
// résultats et les classifications, pas des effets de bord (il n'y en a pas).

import { describe, it, expect } from 'vitest'
import {
  previewNewSimple,
  previewModifyCycleGrid,
  previewSuspendWindow,
  type DraftSimpleTemplate,
} from '@/lib/planning/impact-preview'
import type { DraftCycle } from '@/lib/planning/cycle-preview'
import { occurrenceKey, projectOccurrences, type ProjectableTemplate } from '@/lib/planning/projection'
import type { ProjectableClosure } from '@/lib/planning/closures'

describe('previewNewSimple', () => {
  const draft: DraftSimpleTemplate = {
    missionId: 'mission-1',
    frequency: 'weekly',
    slots: null,
    dayOfWeek: 1, // lundi
    dayOfMonth: null,
    plannedStartHHMM: '08:00',
    plannedEndHHMM: '10:00',
    startsOn: '2026-10-01',
    endsOn: null,
  }

  it('projette uniquement dans la fenêtre [from, to] — jamais au-delà', () => {
    const occurrences = previewNewSimple({ draft, from: '2026-10-01', to: '2026-10-31' })
    expect(occurrences.length).toBeGreaterThan(0)
    for (const o of occurrences) {
      expect(o.scheduledFor >= '2026-10-01').toBe(true)
      expect(o.scheduledFor <= '2026-10-31').toBe(true)
    }
  })

  it('fenêtre vide (from > to trié à l’envers) ne casse pas et ne matérialise rien', () => {
    const occurrences = previewNewSimple({ draft, from: '2026-11-01', to: '2026-10-01' })
    expect(occurrences).toEqual([])
  })

  it('est pur — deux appels identiques donnent le même résultat', () => {
    const a = previewNewSimple({ draft, from: '2026-10-01', to: '2026-10-31' })
    const b = previewNewSimple({ draft, from: '2026-10-01', to: '2026-10-31' })
    expect(b).toEqual(a)
  })
})

describe('previewModifyCycleGrid', () => {
  const before: DraftCycle = {
    missionId: 'mission-1',
    cycleLengthWeeks: 1,
    anchorDate: '2026-10-05',
    startsOn: '2026-10-05',
    endsOn: null,
    slots: [{ weekIndex: 0, weekday: 1, teamId: 'team-a', state: 'work', startTime: '08:00', endTime: '12:00' }],
  }

  const after: DraftCycle = {
    ...before,
    slots: [
      { weekIndex: 0, weekday: 1, teamId: 'team-a', state: 'work', startTime: '08:00', endTime: '12:00' },
      { weekIndex: 0, weekday: 3, teamId: 'team-b', state: 'work', startTime: '09:00', endTime: '13:00' },
    ],
  }

  it("expose before et after distincts — jamais fusionnés", () => {
    const preview = previewModifyCycleGrid({ before, after, closures: [], from: '2026-10-05', to: '2026-10-18' })
    expect(preview.before.summary.workedDays).toBeLessThan(preview.after.summary.workedDays)
  })

  it('before ne reflète que la grille AVANT même si after ajoute des jours', () => {
    const preview = previewModifyCycleGrid({ before, after, closures: [], from: '2026-10-05', to: '2026-10-18' })
    const beforeTeams = new Set(preview.before.days.flatMap((d) => d.working.map((w) => w.teamId)))
    expect(beforeTeams.has('team-b')).toBe(false)
  })

  it('ne touche à aucune donnée persistée — before/after purement virtuels', () => {
    const closures: ProjectableClosure[] = []
    const preview = previewModifyCycleGrid({ before, after, closures, from: '2026-10-05', to: '2026-10-18' })
    expect(preview.after.days.length).toBeGreaterThan(0)
  })
})

describe('previewSuspendWindow', () => {
  const template: ProjectableTemplate = {
    id: 'template-1',
    mission_id: 'mission-1',
    frequency: 'weekly',
    slots: null,
    day_of_week: 1,
    day_of_month: null,
    planned_start_hhmm: '08:00',
    planned_end_hhmm: '10:00',
    starts_on: '2026-10-01',
    ends_on: null,
  }

  it('classe chaque occurrence projetée en matérialisée ou projected-only', () => {
    const occurrences = projectOccurrences({ templates: [template], from: '2026-10-01', to: '2026-10-31' })
    const firstKey = occurrenceKey(occurrences[0])
    const materializedOccurrenceKeys = new Set([firstKey])

    const preview = previewSuspendWindow({
      templates: [template],
      materializedOccurrenceKeys,
      from: '2026-10-01',
      to: '2026-10-31',
    })

    expect(preview.summary.totalOccurrences).toBe(occurrences.length)
    expect(preview.summary.materializedCount).toBe(1)
    expect(preview.summary.projectedOnlyCount).toBe(occurrences.length - 1)

    const materialized = preview.occurrences.filter((o) => o.materialized)
    expect(materialized).toHaveLength(1)
    expect(materialized[0].skippable).toBe(true)
  })

  it('une occurrence purement projetée (au-delà du cap de matérialisation) n’est jamais skippable', () => {
    const preview = previewSuspendWindow({
      templates: [template],
      materializedOccurrenceKeys: new Set(),
      from: '2026-10-01',
      to: '2026-10-08',
    })
    expect(preview.summary.materializedCount).toBe(0)
    for (const o of preview.occurrences) {
      expect(o.materialized).toBe(false)
      expect(o.skippable).toBe(false)
    }
  })

  it('ne matérialise rien — aucune ligne produite au-delà de la classification en mémoire', () => {
    const preview = previewSuspendWindow({
      templates: [template],
      materializedOccurrenceKeys: new Set(),
      from: '2026-10-01',
      to: '2026-10-08',
    })
    expect(preview.summary.totalOccurrences).toBe(preview.occurrences.length)
  })
})
