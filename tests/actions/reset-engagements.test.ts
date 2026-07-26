import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRoleById: vi.fn(),
  listEngagementsByTender: vi.fn(),
  deleteExtractedEngagementsByTender: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/db/users', () => ({ getUserRoleById: mocks.getUserRoleById }))
vi.mock('@/lib/db/contracts', () => ({ createContract: vi.fn() }))
vi.mock('@/lib/db/tenders', () => ({
  getTender: vi.fn(),
  listTenderDocuments: vi.fn(),
  getLatestTenderAnalysis: vi.fn(),
}))
vi.mock('@/lib/db/engagements', () => ({
  activateEngagementsForContract: vi.fn(),
  archiveEngagement: vi.fn(),
  bulkInsertEngagements: vi.fn(),
  createEngagementManual: vi.fn(),
  curateEngagement: vi.fn(),
  deleteExtractedEngagementsByTender: mocks.deleteExtractedEngagementsByTender,
  hasLinkedInterventions: vi.fn(),
  listEngagementsByTender: mocks.listEngagementsByTender,
  rejectEngagements: vi.fn(),
}))
vi.mock('@/services/ai/engagement-extraction', () => ({ runEngagementExtractionAgent: vi.fn() }))

import { resetEngagementsAction } from '@/app/(dashboard)/tenders/[id]/engagements-actions'

const tenderId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

function makeFormData(id: string = tenderId) {
  const fd = new FormData()
  fd.set('tender_id', id)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
  })
  mocks.getUserRoleById.mockResolvedValue('manager')
  mocks.deleteExtractedEngagementsByTender.mockResolvedValue(12)
})

describe('resetEngagementsAction', () => {
  it('refuse un utilisateur non admin/manager', async () => {
    mocks.getUserRoleById.mockResolvedValue('chef_equipe')

    const result = await resetEngagementsAction(makeFormData())

    expect(result).toEqual({ error: 'Forbidden' })
    expect(mocks.deleteExtractedEngagementsByTender).not.toHaveBeenCalled()
  })

  it('refuse un tender_id invalide', async () => {
    const result = await resetEngagementsAction(makeFormData('pas-un-uuid'))
    expect(result).toEqual({ error: 'Invalid input' })
    expect(mocks.deleteExtractedEngagementsByTender).not.toHaveBeenCalled()
  })

  it('refuse si un engagement est déjà rattaché à un contrat (jamais destructif)', async () => {
    mocks.listEngagementsByTender.mockResolvedValue([
      { id: 'e-1', contract_id: null },
      { id: 'e-2', contract_id: 'contract-9' },
    ])

    const result = await resetEngagementsAction(makeFormData())

    expect(result).toEqual({ error: expect.stringContaining('rattaché') })
    expect(mocks.deleteExtractedEngagementsByTender).not.toHaveBeenCalled()
  })

  it('supprime les engagements extraits et renvoie le compte', async () => {
    mocks.listEngagementsByTender.mockResolvedValue([
      { id: 'e-1', contract_id: null },
      { id: 'e-2', contract_id: null },
    ])

    const result = await resetEngagementsAction(makeFormData())

    expect(result).toEqual({ ok: true, count: 12 })
    expect(mocks.deleteExtractedEngagementsByTender).toHaveBeenCalledWith(tenderId)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/tenders/${tenderId}/engagements`)
  })
})
