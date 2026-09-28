// OCC-ID-1 — identité canonique d'une occurrence = template_id + scheduled_for + slot.
//
// buildMonthRows/buildTeamMonthRows dédupliquaient projeté vs matérialisé sur
// template_id (± scheduled_for) SEUL : un rythme à deux passages le même jour
// (ex. Nettoyage Z2 matin+après-midi) perdait l'après-midi encore projeté dès
// que le matin devenait une intervention réelle. Le correctif réutilise
// occurrenceKey() (lib/planning/projection.ts) — même identité que la base
// (contrainte unique mig 198), aucun nouveau système d'identité.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}

function makeFakeDb() {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return api },
        is: (col: string, val: unknown) => { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return api },
        gte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) >= String(val)); return api },
        lte: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] != null && String(r[col]) <= String(val)); return api },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return api },
        order: () => api,
        limit: (n: number) => { rows = rows.slice(0, n); return api },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      }
      return api
    },
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeFakeDb(),
}))

const ORG = 'org-1'
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => [ORG],
}))

const { buildMonthRows, buildTeamMonthRows } = await import('@/lib/db/month-view')

const SITE = { id: 'site-1', name: 'OCEF Compostage', organization_id: ORG, client: null }
const DAY = '2026-09-29'
const FROM = '2026-09-01'
const TO = '2026-09-30'

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    mission_id: 'm-1',
    frequency: 'daily',
    slots: ['morning', 'afternoon'],
    day_of_week: null,
    day_of_month: null,
    planned_start_hhmm: null,
    planned_end_hhmm: null,
    starts_on: '2026-01-01',
    ends_on: null,
    active: true,
    deleted_at: null,
    assigned_team_id: 'team-1',
    cycle_id: null,
    missions: { id: 'm-1', name: 'Nettoyage Z2', site_id: SITE.id, sites: SITE },
    team: { id: 'team-1', name: 'DISCOUNT P1', color: 'sky' },
    ...overrides,
  }
}

function intervention(overrides: Record<string, unknown> = {}) {
  return {
    id: 'itv-1',
    template_id: 'tpl-1',
    scheduled_for: DAY,
    slot: 'morning',
    status: 'planned',
    assigned_team_id: 'team-1',
    planned_start: `${DAY}T08:00:00.000Z`,
    planned_end: `${DAY}T10:00:00.000Z`,
    missions: { site_id: SITE.id, sites: SITE },
    ...overrides,
  }
}

beforeEach(() => {
  tables = {
    interventions: [],
    intervention_templates: [],
    site_closures: [],
    closure_conflict_decision: [],
    teams: [],
    team_members: [],
  }
})

describe('buildMonthRows — OCC-ID-1 identité complète template_id + scheduled_for + slot', () => {
  it('A. matin matérialisé + après-midi projeté (même template, même jour) → les deux restent visibles', async () => {
    tables.interventions = [intervention({ slot: 'morning' })]
    tables.intervention_templates = [template()]

    const rows = await buildMonthRows({ from: FROM, to: TO })
    const facts = rows[0].days[DAY]

    expect(facts.expected).toBe(1) // le matin matérialisé, encore "planned"
    expect((facts.projectedOccurrences ?? []).map((o) => o.slot).sort()).toEqual(['afternoon'])
    expect(facts.projected).toBe(1)
  })

  it('B. même template/jour/slot matérialisé → la projection correspondante disparaît', async () => {
    tables.interventions = [intervention({ slot: 'morning' }), intervention({ id: 'itv-2', slot: 'afternoon' })]
    tables.intervention_templates = [template()]

    const rows = await buildMonthRows({ from: FROM, to: TO })
    const facts = rows[0].days[DAY]

    expect(facts.projectedOccurrences).toHaveLength(0)
    expect(facts.projected).toBe(0)
    expect(facts.expected).toBe(2)
  })

  it('C. aucun slot matérialisé → les deux slots projetés (matin + après-midi) sont deux occurrences distinctes', async () => {
    tables.interventions = []
    tables.intervention_templates = [template()]

    const rows = await buildMonthRows({ from: FROM, to: TO })
    const facts = rows[0].days[DAY]

    expect(facts.projectedOccurrences).toHaveLength(2)
    expect((facts.projectedOccurrences ?? []).map((o) => o.slot).sort()).toEqual(['afternoon', 'morning'])
    expect(facts.projected).toBe(2)
  })

  it('D. deux templates différents, même jour, même slot matérialisé sur un seul → aucune collision', async () => {
    tables.interventions = [intervention({ id: 'itv-1', template_id: 'tpl-1', slot: 'morning' })]
    tables.intervention_templates = [
      template({ id: 'tpl-1', slots: ['morning'] }),
      template({
        id: 'tpl-2',
        mission_id: 'm-2',
        slots: ['morning'],
        missions: { id: 'm-2', name: 'Sécurisation accès', site_id: SITE.id, sites: SITE },
      }),
    ]

    const rows = await buildMonthRows({ from: FROM, to: TO })
    const facts = rows[0].days[DAY]

    // tpl-1/morning est matérialisé (disparaît de projectedOccurrences) ;
    // tpl-2/morning reste projeté — un template matérialisé n'efface pas l'autre.
    expect(facts.projectedOccurrences).toHaveLength(1)
    expect((facts.projectedOccurrences ?? [])[0].templateId).toBe('tpl-2')
  })
})

describe('buildTeamMonthRows — OCC-ID-1 même identité côté équipe', () => {
  it('E. matin matérialisé + après-midi projeté → la ligne équipe compte worked=1 ET projected=1, pas de disparition', async () => {
    tables.interventions = [intervention({ slot: 'morning' })]
    tables.intervention_templates = [template()]
    tables.teams = [{ id: 'team-1', name: 'DISCOUNT P1', organization_id: ORG }]

    const siteRows = await buildMonthRows({ from: FROM, to: TO })
    const teamRows = await buildTeamMonthRows({ from: FROM, to: TO, siteRows })
    const team = teamRows.find((t) => t.teamId === 'team-1')!
    const facts = team.days[DAY]

    expect(facts.worked).toBe(1)
    expect(facts.projected).toBe(1)
  })
})
