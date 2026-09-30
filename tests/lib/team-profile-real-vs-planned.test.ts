import { describe, it, expect, beforeEach, vi } from 'vitest'

// FIX 3 (revue ChatGPT/Vincent, cd30aa2d) — WOW Équipe fusionnait `planned`
// avec les statuts réellement constatés (in_progress/completed/validated)
// dans les mêmes compteurs, présentant du prévu comme du réalisé.
// listTeamFavoriteSites / listTeamContractsCovered / getTeamRhythm14d /
// getTeamHeatmap90d doivent désormais compter le réel et le planifié
// séparément, sans jamais les sommer silencieusement.

vi.mock('server-only', () => ({}))

let interventionRows: Array<Record<string, unknown>> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'interventions') return makeBuilder(() => ({ data: interventionRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

vi.mock('@/lib/storage/intervention-photos', () => ({
  getSignedPhotoUrlsThumb: async (paths: string[]) => new Map(paths.map((p) => [p, `signed://${p}`])),
}))

vi.mock('@/lib/db/teams', () => ({
  getTeamDependencies: async () => ({ futureInterventions: 0, rotationSlots: 0, rotationCycleCount: 0, rotationSiteNames: [] }),
}))

import {
  listTeamFavoriteSites,
  listTeamContractsCovered,
  getTeamRhythm14d,
  getTeamHeatmap90d,
} from '@/lib/db/team-profile'

function interventionRow(opts: {
  id: string
  status: string
  scheduledFor: string
  siteId?: string
  contractId?: string | null
}) {
  return {
    id: opts.id,
    scheduled_for: opts.scheduledFor,
    status: opts.status,
    planned_start: null,
    planned_end: null,
    mission: {
      name: 'Nettoyage',
      site: {
        id: opts.siteId ?? 's-1',
        name: 'Site Test',
        contract: opts.contractId ? { id: opts.contractId, name: 'Contrat Test' } : null,
        client: null,
      },
    },
  }
}

// getTeamRhythm14d/getTeamHeatmap90d dérivent leurs clés de date en
// Pacific/Noumea (yyyymmddInTz) — un scheduled_for en UTC brut peut retomber
// sur la veille/le lendemain selon l'heure d'exécution du test. On aligne
// donc explicitement le timestamp sur le jour calendaire Nouméa du jour.
function todayIso(): string {
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Noumea' })
  return `${dateStr}T00:00:00Z`
}

beforeEach(() => {
  interventionRows = []
})

describe('FIX 3 — listTeamFavoriteSites : réel et planifié jamais sommés', () => {
  it('une intervention completed compte en interventionCount, jamais dans plannedInterventionCount', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'completed', scheduledFor: '2026-09-01T00:00:00Z' })]
    const out = await listTeamFavoriteSites('t-1')
    expect(out).toHaveLength(1)
    expect(out[0].interventionCount).toBe(1)
    expect(out[0].plannedInterventionCount).toBe(0)
  })

  it('une intervention planned compte en plannedInterventionCount, jamais dans interventionCount', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'planned', scheduledFor: '2026-09-01T00:00:00Z' })]
    const out = await listTeamFavoriteSites('t-1')
    expect(out).toHaveLength(1)
    expect(out[0].interventionCount).toBe(0)
    expect(out[0].plannedInterventionCount).toBe(1)
  })

  it('mélange completed + planned sur le même site : compteurs distincts, jamais fusionnés', async () => {
    interventionRows = [
      interventionRow({ id: 'i-1', status: 'completed', scheduledFor: '2026-09-01T00:00:00Z' }),
      interventionRow({ id: 'i-2', status: 'in_progress', scheduledFor: '2026-09-02T00:00:00Z' }),
      interventionRow({ id: 'i-3', status: 'planned', scheduledFor: '2026-09-10T00:00:00Z' }),
    ]
    const out = await listTeamFavoriteSites('t-1')
    expect(out).toHaveLength(1)
    expect(out[0].interventionCount).toBe(2)
    expect(out[0].plannedInterventionCount).toBe(1)
  })

  it('skipped est ignoré (ni réel ni planifié)', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'skipped', scheduledFor: '2026-09-01T00:00:00Z' })]
    const out = await listTeamFavoriteSites('t-1')
    expect(out).toEqual([])
  })
})

describe('FIX 3 — listTeamContractsCovered : réel et planifié jamais sommés', () => {
  it('completed → interventionCount ; planned → plannedInterventionCount', async () => {
    interventionRows = [
      interventionRow({ id: 'i-1', status: 'completed', scheduledFor: '2026-09-01T00:00:00Z', contractId: 'c-1' }),
      interventionRow({ id: 'i-2', status: 'planned', scheduledFor: '2026-09-05T00:00:00Z', contractId: 'c-1' }),
    ]
    const out = await listTeamContractsCovered('t-1')
    expect(out).toHaveLength(1)
    expect(out[0].interventionCount).toBe(1)
    expect(out[0].plannedInterventionCount).toBe(1)
  })
})

describe('FIX 3 — getTeamRhythm14d : count = réel uniquement, plannedCount séparé', () => {
  it('intervention completed aujourd’hui → count=1, plannedCount=0', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'completed', scheduledFor: todayIso() })]
    const out = await getTeamRhythm14d('t-1')
    const today = out.find((d) => d.isToday)
    expect(today?.count).toBe(1)
    expect(today?.plannedCount).toBe(0)
  })

  it('intervention planned aujourd’hui → count=0, plannedCount=1, jamais fusionné', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'planned', scheduledFor: todayIso() })]
    const out = await getTeamRhythm14d('t-1')
    const today = out.find((d) => d.isToday)
    expect(today?.count).toBe(0)
    expect(today?.plannedCount).toBe(1)
  })

  it('tooltipLines ne contient jamais une intervention planned', async () => {
    interventionRows = [interventionRow({ id: 'i-1', status: 'planned', scheduledFor: todayIso() })]
    const out = await getTeamRhythm14d('t-1')
    const today = out.find((d) => d.isToday)
    expect(today?.tooltipLines).toEqual([])
  })
})

describe('FIX 3 — getTeamHeatmap90d : count = réel uniquement, plannedCount séparé', () => {
  it('completed et planned le même jour → deux compteurs distincts', async () => {
    const iso = todayIso()
    interventionRows = [
      interventionRow({ id: 'i-1', status: 'validated', scheduledFor: iso }),
      interventionRow({ id: 'i-2', status: 'planned', scheduledFor: iso }),
    ]
    const out = await getTeamHeatmap90d('t-1')
    const last = out[out.length - 1]
    expect(last.count).toBe(1)
    expect(last.plannedCount).toBe(1)
  })
})
