import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  hasLinkedInterventions: vi.fn(),
  listEngagementsByTender: mocks.listEngagementsByTender,
  rejectEngagements: vi.fn(),
}))
vi.mock('@/services/ai/engagement-extraction', () => ({
  runEngagementExtractionAgent: mocks.runEngagementExtractionAgent,
}))

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
}

function makeFormData() {
  const formData = new FormData()
  formData.set('tender_id', tenderId)
  return formData
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
  mocks.runEngagementExtractionAgent.mockResolvedValue({
    engagements: [extractedEngagement],
  })
  mocks.bulkInsertEngagements.mockResolvedValue([])
})

describe('extractEngagementsAction provenance enrichment', () => {
  it('passes uniquely verified document and marker page to bulk insertion', async () => {
    mocks.listTenderDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        filename: 'CCAP.pdf',
        kind: 'ccap',
        extracted_text: '[[page 7]]\nNettoyage quotidien des locaux.',
      },
    ])

    const result = await extractEngagementsAction(makeFormData())

    expect(result).toEqual({ ok: true, count: 1 })
    expect(mocks.bulkInsertEngagements).toHaveBeenCalledWith(expect.objectContaining({
      tender_id: tenderId,
      created_by: userId,
      engagements: [expect.objectContaining({
        source_excerpt: extractedEngagement.source_excerpt,
        tender_document_id: 'doc-1',
        page_number: 7,
      })],
    }))
  })

  it('passes null provenance when matching filenames are ambiguous', async () => {
    mocks.listTenderDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        filename: 'CCAP.pdf',
        kind: 'ccap',
        extracted_text: '[[page 7]]\nNettoyage quotidien des locaux.',
      },
      {
        id: 'doc-2',
        filename: ' ccap.pdf ',
        kind: 'ccap',
        extracted_text: 'Une autre pièce.',
      },
    ])

    await extractEngagementsAction(makeFormData())

    expect(mocks.bulkInsertEngagements).toHaveBeenCalledWith(expect.objectContaining({
      engagements: [expect.objectContaining({
        tender_document_id: null,
        page_number: null,
      })],
    }))
  })
})
