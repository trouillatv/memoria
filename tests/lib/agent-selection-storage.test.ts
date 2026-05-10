import { describe, it, expect, beforeEach } from 'vitest'
import { loadSelectedAgents, saveSelectedAgents } from '@/app/(dashboard)/tenders/[id]/agent-selection-storage'

const TENDER_ID = '00000000-0000-0000-0000-000000000001'

describe('agent-selection-storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when key absent', () => {
    expect(loadSelectedAgents(TENDER_ID)).toEqual([])
  })

  it('saves and loads agent list', () => {
    saveSelectedAgents(TENDER_ID, ['contradicteur', 'financier'])
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier'])
  })

  it('returns empty array on corrupted JSON', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, 'not-json{{')
    expect(loadSelectedAgents(TENDER_ID)).toEqual([])
  })

  it('filters out invalid agent names', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, JSON.stringify(['contradicteur', 'unknown_agent', 'financier']))
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier'])
  })

  it('caps to 3 agents on load', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, JSON.stringify(['contradicteur', 'financier', 'terrain', 'general']))
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier', 'terrain'])
  })

  it('isolates tenders by id', () => {
    saveSelectedAgents('tender-A', ['contradicteur'])
    saveSelectedAgents('tender-B', ['financier'])
    expect(loadSelectedAgents('tender-A')).toEqual(['contradicteur'])
    expect(loadSelectedAgents('tender-B')).toEqual(['financier'])
  })
})
