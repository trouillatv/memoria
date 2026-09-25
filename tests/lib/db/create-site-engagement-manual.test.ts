// P0-3.1A (mandat Vincent 2026-09-25) — Engagement Porte B créé manuellement
// depuis Prestations prévues, sans document contractuel. Preuves attendues :
// insert correctement formé (status/site/tender/contract/source_document_id/
// source_type), organisation dérivée du chantier (jamais du client), accès
// refusé hors organisation, fallback description→libellé, measurable
// conservé, proof/destination déterministes (réutilisation defaultProofForKind
// / suggestDestination, pas de logique dupliquée).

import { beforeEach, describe, expect, it, vi } from 'vitest'

type InsertRecord = { table: string; payload: Record<string, unknown> }

let insertLog: InsertRecord[] = []
let insertResult: { data: unknown; error: Error | null } = { data: null, error: null }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          insertLog.push({ table, payload })
          return {
            select() {
              return {
                single: () => Promise.resolve(insertResult),
              }
            },
          }
        },
      }
    },
  }),
}))

vi.mock('@/lib/db/sites', () => ({
  getSiteById: vi.fn(),
}))

vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: vi.fn(),
}))

import { createSiteEngagementManual } from '@/lib/db/engagements'
import { getSiteById } from '@/lib/db/sites'
import { requireOrganizationMembership } from '@/lib/auth/memberships'

const mockedGetSiteById = vi.mocked(getSiteById)
const mockedRequireOrgMembership = vi.mocked(requireOrganizationMembership)

function fakeSite(overrides: Record<string, unknown> = {}) {
  return { id: 'site-1', organization_id: 'org-1', name: 'Chantier Test', ...overrides } as unknown as Awaited<ReturnType<typeof getSiteById>>
}

function insertedRow(overrides: Record<string, unknown> = {}) {
  return { id: 'eng-99', ...overrides }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    site_id: 'site-1',
    short_label: 'Nettoyage hebdomadaire des vitres',
    source_excerpt: null as string | null,
    category: 'frequency' as const,
    kind: null as null,
    measurable: false,
    created_by: 'user-1',
    ...overrides,
  }
}

beforeEach(() => {
  insertLog = []
  insertResult = { data: insertedRow(), error: null }
  mockedGetSiteById.mockReset()
  mockedRequireOrgMembership.mockReset()
  mockedGetSiteById.mockResolvedValue(fakeSite())
  mockedRequireOrgMembership.mockResolvedValue({
    ok: true,
    context: { userId: 'user-1', organizationId: 'org-1', role: 'admin' },
  } as Awaited<ReturnType<typeof requireOrganizationMembership>>)
})

describe('createSiteEngagementManual — Porte B manuelle', () => {
  it('insère sur engagements avec status=curated, site_id correct, tender/contract/source_document_id=null, source_type=manual', async () => {
    await createSiteEngagementManual(baseInput())

    expect(insertLog).toHaveLength(1)
    const { table, payload } = insertLog[0]
    expect(table).toBe('engagements')
    expect(payload.status).toBe('curated')
    expect(payload.site_id).toBe('site-1')
    expect(payload.tender_id).toBeNull()
    expect(payload.contract_id).toBeNull()
    expect(payload.source_document_id).toBeNull()
    expect(payload.page_number).toBeNull()
    expect(payload.source_type).toBe('manual')
    expect(payload.ai_confidence).toBeNull()
  })

  it("dérive organization_id du chantier (getSiteById) et ne l'accepte jamais depuis l'appelant", async () => {
    mockedGetSiteById.mockResolvedValue(fakeSite({ organization_id: 'org-derived-from-site' }))
    mockedRequireOrgMembership.mockResolvedValue({
      ok: true,
      context: { userId: 'user-1', organizationId: 'org-derived-from-site', role: 'admin' },
    } as Awaited<ReturnType<typeof requireOrganizationMembership>>)

    await createSiteEngagementManual(baseInput())

    expect(mockedRequireOrgMembership).toHaveBeenCalledWith('org-derived-from-site')
    expect(insertLog[0].payload.organization_id).toBe('org-derived-from-site')
  })

  it('accès hors organisation : requireOrganizationMembership refuse → aucune écriture', async () => {
    mockedRequireOrgMembership.mockResolvedValue({ ok: false, error: 'Accès refusé' })

    await expect(createSiteEngagementManual(baseInput())).rejects.toThrow('Accès refusé')
    expect(insertLog).toHaveLength(0)
  })

  it('chantier introuvable : aucune écriture, jamais de fallback silencieux', async () => {
    mockedGetSiteById.mockResolvedValue(null)

    await expect(createSiteEngagementManual(baseInput())).rejects.toThrow('Chantier introuvable')
    expect(insertLog).toHaveLength(0)
    expect(mockedRequireOrgMembership).not.toHaveBeenCalled()
  })

  it('fallback : description absente ou trop courte (<5 car.) → source_excerpt = short_label', async () => {
    await createSiteEngagementManual(baseInput({ source_excerpt: null }))
    expect(insertLog[0].payload.source_excerpt).toBe('Nettoyage hebdomadaire des vitres')

    insertLog = []
    await createSiteEngagementManual(baseInput({ source_excerpt: 'ok' }))
    expect(insertLog[0].payload.source_excerpt).toBe('Nettoyage hebdomadaire des vitres')
  })

  it('description suffisamment renseignée (≥5 car.) est conservée telle quelle', async () => {
    await createSiteEngagementManual(baseInput({ source_excerpt: 'Vitres extérieures et intérieures, tous les lundis matin' }))
    expect(insertLog[0].payload.source_excerpt).toBe('Vitres extérieures et intérieures, tous les lundis matin')
  })

  it('measurable est conservé tel que choisi par l’utilisateur (true et false)', async () => {
    await createSiteEngagementManual(baseInput({ measurable: true }))
    expect(insertLog[0].payload.measurable).toBe(true)

    insertLog = []
    await createSiteEngagementManual(baseInput({ measurable: false }))
    expect(insertLog[0].payload.measurable).toBe(false)
  })

  it('proof_requirement et destination sont déterministes (réutilisation defaultProofForKind/suggestDestination)', async () => {
    await createSiteEngagementManual(baseInput({ kind: 'controle', category: 'quality' }))
    expect(insertLog[0].payload.proof_requirement).toBe('photo')
    expect(insertLog[0].payload.destination).toBe('contract_engagement')

    insertLog = []
    await createSiteEngagementManual(baseInput({ kind: 'penalite', category: 'compliance' }))
    expect(insertLog[0].payload.proof_requirement).toBe('none')
    expect(insertLog[0].payload.destination).toBe('vigilance')

    insertLog = []
    await createSiteEngagementManual(baseInput({ kind: null, category: 'frequency' }))
    expect(insertLog[0].payload.proof_requirement).toBe('none')
    expect(insertLog[0].payload.destination).toBe('contract_engagement')
  })

  it('propage une erreur Supabase sur l’insertion', async () => {
    insertResult = { data: null, error: new Error('database unavailable') }

    await expect(createSiteEngagementManual(baseInput())).rejects.toThrow('database unavailable')
  })
})
