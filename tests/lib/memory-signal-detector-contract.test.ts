import { describe, expect, it } from 'vitest'
import type { MemorySignalDetector } from '@/lib/memory/signals/detector'
import type { MemorySignal, OperationalSignalTrigger } from '@/lib/memory/signals/operational-contract'

describe('MemorySignalDetector contract', () => {
  it('exposes a versioned synchronous detector protocol', () => {
    const signal = {} as MemorySignal
    const detector: MemorySignalDetector<{ siteId: string }> = {
      id: 'promise-expired',
      version: '1',
      detect: (context, now) => {
        expect(context.siteId).toBe('site-1')
        expect(now).toBe('2026-07-25T00:00:00.000Z')
        return [signal]
      },
    }

    expect(detector.detect({ siteId: 'site-1' }, '2026-07-25T00:00:00.000Z')).toEqual([signal])
  })

  it('supports both promise trigger reasons', () => {
    const expired: OperationalSignalTrigger = { type: 'promise', reason: 'promise_expired' }
    const withoutDueDate: OperationalSignalTrigger = { type: 'promise', reason: 'promise_without_due_date' }

    expect(expired).toEqual({ type: 'promise', reason: 'promise_expired' })
    expect(withoutDueDate).toEqual({ type: 'promise', reason: 'promise_without_due_date' })
  })
})
