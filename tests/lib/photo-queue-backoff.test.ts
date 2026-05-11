// Slice A.1 — Pure helpers tests for the photo queue backoff logic.
//
// Tests :
//   1. nextRetryDelay(0)   → 1000
//   2. nextRetryDelay(3)   → 120_000
//   3. nextRetryDelay(100) → 3_600_000 (capped at 1h)
//   4. isReadyForRetry({attempts: 0, lastAttemptAt: undefined}) → true
//   5. isReadyForRetry({attempts: 0, lastAttemptAt: now - 500}) → false
//   6. isReadyForRetry({attempts: 0, lastAttemptAt: now - 2000}) → true
//   7. isReadyForRetry({attempts: 3, lastAttemptAt: now - 60_000}) → false
//   8. isReadyForRetry({attempts: 3, lastAttemptAt: now - 130_000}) → true

import { describe, it, expect } from 'vitest'
import {
  BACKOFF_DELAYS_MS,
  nextRetryDelay,
  isReadyForRetry,
} from '@/lib/field/photo-queue'

describe('nextRetryDelay', () => {
  it('attempts 0 → 1s', () => {
    expect(nextRetryDelay(0)).toBe(1_000)
  })

  it('attempts 1 → 5s', () => {
    expect(nextRetryDelay(1)).toBe(5_000)
  })

  it('attempts 2 → 30s', () => {
    expect(nextRetryDelay(2)).toBe(30_000)
  })

  it('attempts 3 → 2 min', () => {
    expect(nextRetryDelay(3)).toBe(120_000)
  })

  it('attempts 4 → 10 min', () => {
    expect(nextRetryDelay(4)).toBe(600_000)
  })

  it('attempts 5 → 30 min', () => {
    expect(nextRetryDelay(5)).toBe(1_800_000)
  })

  it('attempts 6 → 1 h', () => {
    expect(nextRetryDelay(6)).toBe(3_600_000)
  })

  it('attempts 100 (capped) → 1 h', () => {
    expect(nextRetryDelay(100)).toBe(3_600_000)
  })

  it('attempts négatif → 1s (premier seuil)', () => {
    expect(nextRetryDelay(-1)).toBe(1_000)
  })

  it('BACKOFF_DELAYS_MS est croissant', () => {
    for (let i = 1; i < BACKOFF_DELAYS_MS.length; i++) {
      expect(BACKOFF_DELAYS_MS[i]).toBeGreaterThan(BACKOFF_DELAYS_MS[i - 1])
    }
  })
})

describe('isReadyForRetry', () => {
  it('jamais tenté (lastAttemptAt undefined) → true', () => {
    expect(isReadyForRetry({ attempts: 0, lastAttemptAt: undefined })).toBe(true)
  })

  it('jamais tenté, attempts élevé → true', () => {
    expect(isReadyForRetry({ attempts: 5, lastAttemptAt: undefined })).toBe(true)
  })

  it('attempts=0, lastAttemptAt il y a 500ms (< 1s) → false', () => {
    expect(
      isReadyForRetry({ attempts: 0, lastAttemptAt: Date.now() - 500 }),
    ).toBe(false)
  })

  it('attempts=0, lastAttemptAt il y a 2000ms (>= 1s) → true', () => {
    expect(
      isReadyForRetry({ attempts: 0, lastAttemptAt: Date.now() - 2_000 }),
    ).toBe(true)
  })

  it('attempts=3, lastAttemptAt il y a 60s (< 2 min) → false', () => {
    expect(
      isReadyForRetry({ attempts: 3, lastAttemptAt: Date.now() - 60_000 }),
    ).toBe(false)
  })

  it('attempts=3, lastAttemptAt il y a 130s (>= 2 min) → true', () => {
    expect(
      isReadyForRetry({ attempts: 3, lastAttemptAt: Date.now() - 130_000 }),
    ).toBe(true)
  })

  it('attempts=6 (capped 1h), lastAttemptAt il y a 30 min → false', () => {
    expect(
      isReadyForRetry({
        attempts: 6,
        lastAttemptAt: Date.now() - 30 * 60 * 1000,
      }),
    ).toBe(false)
  })

  it('attempts=6 (capped 1h), lastAttemptAt il y a 1h05 → true', () => {
    expect(
      isReadyForRetry({
        attempts: 6,
        lastAttemptAt: Date.now() - 65 * 60 * 1000,
      }),
    ).toBe(true)
  })
})
