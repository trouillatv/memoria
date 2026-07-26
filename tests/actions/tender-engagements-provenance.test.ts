import { beforeEach, describe, expect, it, vi } from 'vitest'

// Extraction PIÈCE PAR PIÈCE : chaque pièce est lue dans sa propre passe, la
// provenance (document) est CONNUE par construction (pas devinée par un match de
// citation), la page est vérifiée DANS la pièce, et le mémoire technique généré
// est une passe distincte (jamais confondu avec une exigence d'AO).

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRoleById: vi.fn(),
  listEngagementsByTender: vi.fn(),
  getTender: vi.fn(),
  listTenderDocuments: vi.fn(),
  getLatestTenderAnalysis: vi.fn(),
  runEngagementExtractionAgent: vi.fn(),
  bulkInsertEngagements: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/db/users', () => ({ getUserRoleById: mocks.getUserRoleById }))
vi.mock('@/lib/db/contracts', () => ({ createContract: vi.fn() }))
vi.mock('@/lib/db/tenders', () => ({
  getTender: mocks.getTender,
  listTenderDocuments: mocks.listTenderDocuments,
  getLatestTenderAnalysis: mocks.getLatestTenderAnalysis,
}))
vi.mock('@/lib/db/engagements', () => ({
  activateEngagementsForContract: vi.fn(),
  archiveEngagement: vi.fn(),
  bulkInsertEngagements: mocks.bulkInsertEngagements,
  createEngagementManual: vi.fn(),
  curateEngagement: vi.fn(),
  deleteExtractedEngagementsByTender: vi.fn(),
  hasLinkedInterventions: vi.fn(),
  listEngagementsByTender: mocks.listEngagementsByTender,
  rejectEngagements: vi.fn(),
}))
vi.mock('@/services/ai/engagement-extraction', () => ({
  runEngagementExtractionAgent: mocks.runEngagementExtractionAgent,
}))
// Le résolveur de page (engagement-provenance) et l'orchestration
// (extract-engagements) ne sont PAS mockés : on veut la vraie chaîne.

import { extractEngagementsAction } from '@/app/(dashboard)/tenders/[id]/engagements-actions'

const tenderId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

const extractedEngagement = {
  source_type: 'ao_clause' as const,
  source_excerpt: 'nettoyage quotidien des locaux',
  source_ref: { page: 99 },
  category: 'compliance' as const,
  kind: 'obligation' as const,
  short_label: 'Nettoyage quotidien',
  measurable: true,
  ai_confidence: 0.9,
  tender_document_id: null,
}

function makeFormData() {
  const formData = new FormData()
  formData.set('tender_id', tenderId)
  return formData
}

function insertedEngagements() {
  return mocks.bulkInsertEngagements.mock.calls[0]![0].engagements as Array<{
    source_type: string
    tender_document_id: string | null
    page_number: number | null
  }>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
  })
  mocks.getUserRoleById.mockResolvedValue('manager')
  mocks.listEngagementsByTender.mockResolvedValue([])
  mocks.getTender.mockResolvedValue({ id: tenderId })
  mocks.getLatestTenderAnalysis.mockResolvedValue(null)
  mocks.runEngagementExtractionAgent.mockResolvedValue({ engagements: [extractedEngagement] })
  mocks.bulkInsertEngagements.mockResolvedValue([])
})

describe('extractEngagementsAction — provenance par pièce', () => {
  it('attribue l\'engagement à SA pièce et vérifie la page par le marqueur [[page N]]', async () => {
    mocks.listTenderDocuments.mockResolvedValue([
      { id: 'doc-1', filename: 'CCAP.pdf', kind: 'ccap', extracted_text: '[[page 7]]\nNettoyage quotidien des locaux.' },
    ])

    const result = await extractEngagementsAction(makeFormData())

    expect(result).toEqual({ ok: true, count: 1, failedSources: 0 })
    expect(insertedEngagements()).toEqual([
      expect.objectContaining({ source_type: 'ao_clause', tender_document_id: 'doc-1', page_number: 7 }),
    ])
  })

  it('chaque pièce garde SA provenance — aucune réattribution croisée', async () => {
    // La citation n'existe que dans doc-1. Le mock renvoie le même engagement
    // pour les deux passes : doc-1 le localise (page 7), doc-2 ne le localise pas
    // (page null) — mais reste attribué à doc-2, jamais à doc-1.
    mocks.listTenderDocuments.mockResolvedValue([
      { id: 'doc-1', filename: 'CCAP.pdf', kind: 'ccap', extracted_text: '[[page 7]]\nNettoyage quotidien des locaux.' },
      { id: 'doc-2', filename: 'CCTP.pdf', kind: 'cctp', extracted_text: 'Une autre pièce, sans cette clause.' },
    ])

    await extractEngagementsAction(makeFormData())

    const inserted = insertedEngagements()
    expect(inserted).toHaveLength(2)
    expect(inserted).toContainEqual(expect.objectContaining({ tender_document_id: 'doc-1', page_number: 7 }))
    expect(inserted).toContainEqual(expect.objectContaining({ tender_document_id: 'doc-2', page_number: null }))
    // Jamais de page d'une autre pièce recopiée sur doc-2.
    expect(inserted.every((e) => e.tender_document_id !== null)).toBe(true)
  })

  it('le mémoire technique est une passe distincte : memoire_engagement, document null', async () => {
    mocks.listTenderDocuments.mockResolvedValue([])
    mocks.getLatestTenderAnalysis.mockResolvedValue({ technical_memo: 'Nous garantissons la conformité totale.' })

    const result = await extractEngagementsAction(makeFormData())

    expect(result).toEqual({ ok: true, count: 1, failedSources: 0 })
    expect(insertedEngagements()).toEqual([
      expect.objectContaining({ source_type: 'memoire_engagement', tender_document_id: null, page_number: null }),
    ])
  })

  it('aucune source lisible → erreur explicite, pas d\'insertion', async () => {
    mocks.listTenderDocuments.mockResolvedValue([
      { id: 'doc-1', filename: 'Plan.pdf', kind: 'plan', extracted_text: null },
    ])

    const result = await extractEngagementsAction(makeFormData())

    expect(result).toEqual({ error: 'Aucune pièce lisible ni mémoire technique dans ce dossier' })
    expect(mocks.bulkInsertEngagements).not.toHaveBeenCalled()
  })
})
