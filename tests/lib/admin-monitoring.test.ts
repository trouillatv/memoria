import { describe, expect, it } from 'vitest'
import {
  getPilotHealth,
  summarizeMemoryMoments,
  type PilotUsageRow,
} from '@/lib/db/admin-monitoring'

function row(activeDays30d: number): PilotUsageRow {
  return {
    id: `user-${activeDays30d}`,
    email: `user-${activeDays30d}@memoria.nc`,
    full_name: null,
    role: 'manager',
    last_activity_at: null,
    actions_in_period: 0,
    status: 'inactive',
    active_days_30d: activeDays30d,
    notes_created: 0,
    briefs_created: 0,
    briefs_read: 0,
    documents_consulted: 0,
  }
}

describe('getPilotHealth', () => {
  it('marks the pilot inactive when nobody has an active day', () => {
    expect(getPilotHealth([row(0), row(0)])).toEqual({
      label: 'Inactif',
      tone: 'red',
      activeDays: 0,
    })
  })

  it('marks the pilot as exploration between 1 and 3 active days', () => {
    expect(getPilotHealth([row(1), row(3)])).toEqual({
      label: 'Exploration',
      tone: 'amber',
      activeDays: 3,
    })
  })

  it('marks the pilot as real usage from 4 active days', () => {
    expect(getPilotHealth([row(2), row(4)])).toEqual({
      label: 'Utilisation réelle',
      tone: 'green',
      activeDays: 4,
    })
  })
})

describe('summarizeMemoryMoments', () => {
  it('sums the memory moments that matter for the pilot', () => {
    expect(
      summarizeMemoryMoments({
        notes: 8,
        briefs: 3,
        documents: 2,
        anomalies: 1,
      }),
    ).toEqual({
      total: 14,
      notes: 8,
      briefs: 3,
      documents: 2,
      anomalies: 1,
    })
  })
})
