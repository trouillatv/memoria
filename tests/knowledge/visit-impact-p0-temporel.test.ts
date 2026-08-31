// P0.5-Vérité — getVisitImpact ne doit JAMAIS compter un PV historique importé
// comme « votre dernière visite ». readEvents émet désormais aussi les imports
// (positionnés par effective_date, cf. P0-temporel) pour nourrir l'Historique
// général : l'accueil doit les filtrer via `is_import`, sous peine de dire
// « depuis votre visite » d'un PV importé il y a des mois/années.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SiteEventRow } from '@/lib/knowledge/repository'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/memberships', () => ({ getOrgIdsOfUser: vi.fn(async () => []) }))
vi.mock('@/lib/db/site-deadlines', () => ({ listSiteDeadlines: vi.fn(async () => []) }))

const readEventsMock = vi.fn<(...args: unknown[]) => Promise<SiteEventRow[]>>()
vi.mock('@/lib/knowledge/repository', () => ({
  readEvents: (...args: unknown[]) => readEventsMock(...args),
  readSiteOrganizations: vi.fn(async () => new Map()),
}))

const getSiteOverviewMock = vi.fn()
vi.mock('@/lib/knowledge/site-overview', () => ({
  getSiteOverview: (...args: unknown[]) => getSiteOverviewMock(...args),
}))

function fakeOverview(siteId: string) {
  return {
    identity: { id: siteId, name: `Chantier ${siteId}`, client: null, status: null },
    synthesis: { status: 'none' },
    actions: { proposed: [] },
  }
}

const { getVisitImpact } = await import('@/lib/knowledge/site-events')

function importRow(siteId: string, reportId: string, at: string): SiteEventRow {
  return { site_id: siteId, at, kind: 'visit_ended', report_id: reportId, started_at: null, is_import: true } as SiteEventRow
}

function terrainRow(siteId: string, reportId: string, at: string): SiteEventRow {
  return { site_id: siteId, at, kind: 'visit_ended', report_id: reportId, started_at: at } as SiteEventRow
}

beforeEach(() => {
  readEventsMock.mockReset()
  getSiteOverviewMock.mockReset()
})

describe('getVisitImpact — P0.5-Vérité (un import n’est jamais « votre dernière visite »)', () => {
  it('un site dont le seul événement récent est un import importé reste silencieux (aucune visite)', async () => {
    readEventsMock.mockResolvedValue([importRow('site-bella', 'r-import', '2026-08-20T00:00:00.000Z')])
    getSiteOverviewMock.mockResolvedValue(fakeOverview('site-bella'))

    const impact = await getVisitImpact()
    expect(impact.sites).toEqual([])
  })

  it('un import récent n’occulte pas une vraie visite terrain du même site : seule la visite compte', async () => {
    readEventsMock.mockResolvedValue([
      importRow('site-x', 'r-import', '2026-08-25T00:00:00.000Z'),
      terrainRow('site-x', 'r-terrain', '2026-08-15T07:40:00.000Z'),
    ])
    getSiteOverviewMock.mockResolvedValue(fakeOverview('site-x'))

    const impact = await getVisitImpact()
    expect(impact.sites).toHaveLength(1)
    expect(impact.sites[0].siteId).toBe('site-x')
    // L'import (filtré en amont par is_import) n'apparaît dans aucun événement restitué.
    expect(impact.sites[0].events.map((e) => e.at)).toEqual(['2026-08-15T07:40:00.000Z'])
    expect(impact.sites[0].events[0].label).toBe('Visite terminée')
  })
})
