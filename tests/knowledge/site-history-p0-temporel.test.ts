// P0-temporel — getSiteHistory doit restituer les PV historiques importés triés
// par leur date MÉTIER (documents.effective_date), jamais par l'ordre ou la date
// de traitement (created_at) — et ne jamais reclasser une visite terrain.
//
// readEvents est mocké ici (déjà testé isolément dans repository-read-events.test.ts) :
// ce fichier vérifie la couche au-dessus — tri + dateUnknown + isImport affichés.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SiteEventRow } from '@/lib/knowledge/repository'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/memberships', () => ({ getOrgIdsOfUser: vi.fn(async () => []) }))

const readEventsMock = vi.fn<(...args: unknown[]) => Promise<SiteEventRow[]>>()
const readReportOriginsMock = vi.fn<(ids: string[]) => Promise<Map<string, string | null>>>()
const readImportDocumentDatesMock = vi.fn<(ids: string[]) => Promise<Map<string, string | null>>>()

vi.mock('@/lib/knowledge/repository', () => ({
  readEvents: (...args: unknown[]) => readEventsMock(...args),
  readVisitCaptureCounts: vi.fn(async () => []),
  readFirstVisitId: vi.fn(async () => null),
  readUserNames: vi.fn(async () => []),
  readSiteOrganizations: vi.fn(async () => new Map()),
  readReportOrigins: (ids: string[]) => readReportOriginsMock(ids),
  readMaterializedCountsByReport: vi.fn(async () => new Map()),
  readPendingProposalCountsByReport: vi.fn(async () => new Map()),
  readImportDocumentDates: (ids: string[]) => readImportDocumentDatesMock(ids),
}))

const { getSiteHistory } = await import('@/lib/knowledge/site-events')

function importRow(reportId: string, at: string): SiteEventRow {
  return { site_id: 'site-x', at, kind: 'visit_ended', report_id: reportId, started_at: null, is_import: true } as SiteEventRow
}

function terrainRow(reportId: string, startedAt: string, endedAt: string): SiteEventRow {
  return { site_id: 'site-x', at: endedAt, kind: 'visit_ended', report_id: reportId, started_at: startedAt } as SiteEventRow
}

beforeEach(() => {
  readEventsMock.mockReset()
  readReportOriginsMock.mockReset()
  readImportDocumentDatesMock.mockReset()
})

describe('getSiteHistory — P0-temporel (tri par effective_date, jamais par traitement)', () => {
  it('BELLA : ordre chronologique 19/07/2024 → 05/08/2025 → 22/07/2026 malgré un traitement inversé', async () => {
    // readEvents restitue déjà les `at` résolus par effective_date (cf. repository-read-events.test.ts) ;
    // ici on vérifie que getSiteHistory les TRIE correctement (le plus récent d'abord).
    readEventsMock.mockResolvedValue([
      importRow('r-2026', '2026-07-22'),
      importRow('r-2024', '2024-07-19'),
      importRow('r-2025', '2025-08-05'),
    ])
    readReportOriginsMock.mockResolvedValue(new Map([['r-2026', 'import'], ['r-2024', 'import'], ['r-2025', 'import']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map([['r-2026', '2026-07-22'], ['r-2024', '2024-07-19'], ['r-2025', '2025-08-05']]))

    const entries = await getSiteHistory('site-bella', 3650)
    const visits = entries.filter((e) => e.kind === 'visit') as Array<{ reportId: string; at: string }>
    expect(visits.map((v) => v.reportId)).toEqual(['r-2026', 'r-2025', 'r-2024'])
    expect(visits.map((v) => v.at)).toEqual(['2026-07-22', '2025-08-05', '2024-07-19'])
  })

  it('les 3 PV BELLA apparaissent tous dans la frise générale', async () => {
    readEventsMock.mockResolvedValue([
      importRow('r-2026', '2026-07-22'),
      importRow('r-2024', '2024-07-19'),
      importRow('r-2025', '2025-08-05'),
    ])
    readReportOriginsMock.mockResolvedValue(new Map([['r-2026', 'import'], ['r-2024', 'import'], ['r-2025', 'import']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map([['r-2026', '2026-07-22'], ['r-2024', '2024-07-19'], ['r-2025', '2025-08-05']]))

    const entries = await getSiteHistory('site-bella', 3650)
    expect(entries.filter((e) => e.kind === 'visit')).toHaveLength(3)
  })

  it('OCEF/OCEF6/Vila Dovant : ordre déterminé par effective_date même si l’ordre de traitement est inversé', async () => {
    // Import traité APRÈS mais dont l'effective_date est ANTÉRIEURE : doit sortir après quand même.
    readEventsMock.mockResolvedValue([
      importRow('r-late-processed-old-date', '2023-03-01'),
      importRow('r-early-processed-new-date', '2025-11-10'),
    ])
    readReportOriginsMock.mockResolvedValue(new Map([['r-late-processed-old-date', 'import'], ['r-early-processed-new-date', 'import']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map([['r-late-processed-old-date', '2023-03-01'], ['r-early-processed-new-date', '2025-11-10']]))

    const entries = await getSiteHistory('site-ocef', 3650)
    const visits = entries.filter((e) => e.kind === 'visit') as Array<{ reportId: string }>
    expect(visits.map((v) => v.reportId)).toEqual(['r-early-processed-new-date', 'r-late-processed-old-date'])
  })

  it('une visite terrain n’est jamais reclassée par la logique import (isImport=false, dateUnknown=false, at natif)', async () => {
    readEventsMock.mockResolvedValue([terrainRow('r-terrain', '2026-08-10T07:00:00Z', '2026-08-10T07:40:00Z')])
    readReportOriginsMock.mockResolvedValue(new Map([['r-terrain', 'planned']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map())

    const entries = await getSiteHistory('site-x', 365)
    const visit = entries.find((e) => e.kind === 'visit') as { isImport: boolean; dateUnknown: boolean; at: string }
    expect(visit.isImport).toBe(false)
    expect(visit.dateUnknown).toBe(false)
    expect(visit.at).toBe('2026-08-10T07:40:00Z')
  })

  it('la date d’ingestion d’un import n’est jamais affichée comme date métier quand une effective_date existe', async () => {
    // readEvents renvoie déjà `at` = effective_date (comportement réel) ; on simule ici
    // le cas défensif où `at` porterait encore une trace technique (fallback ended_at/created_at)
    // pour prouver que getSiteHistory privilégie bien importDocDates, pas visit.at, dès qu'elle est connue.
    readEventsMock.mockResolvedValue([importRow('r-1', '2026-08-30T00:00:00Z')])
    readReportOriginsMock.mockResolvedValue(new Map([['r-1', 'import']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map([['r-1', '2024-07-19']]))

    const entries = await getSiteHistory('site-x', 3650)
    const visit = entries.find((e) => e.kind === 'visit') as { at: string; dateUnknown: boolean }
    expect(visit.at).toBe('2024-07-19')
    expect(visit.at).not.toBe('2026-08-30T00:00:00Z')
    expect(visit.dateUnknown).toBe(false)
  })

  it('un import sans effective_date connue est marqué dateUnknown plutôt que positionné sur une date fabriquée', async () => {
    readEventsMock.mockResolvedValue([importRow('r-1', '2026-08-30T00:00:00Z')])
    readReportOriginsMock.mockResolvedValue(new Map([['r-1', 'import']]))
    readImportDocumentDatesMock.mockResolvedValue(new Map([['r-1', null]]))

    const entries = await getSiteHistory('site-x', 3650)
    const visit = entries.find((e) => e.kind === 'visit') as { dateUnknown: boolean; isImport: boolean }
    expect(visit.dateUnknown).toBe(true)
    expect(visit.isImport).toBe(true)
  })
})
