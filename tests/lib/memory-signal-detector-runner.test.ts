import { describe, expect, it } from 'vitest'

import type { MemorySignalDetector } from '@/lib/memory/signals/detector'
import type { MemorySignal } from '@/lib/memory/signals/operational-contract'
import {
  createSignalDetectorRegistration,
  runSignalDetectors,
} from '@/lib/memory/signals/detector-runner'

const source = {
  type: 'test',
  id: 'source-1',
  href: '/source-1',
  label: 'Source test',
}

function signal(
  overrides: Partial<Omit<MemorySignal, 'id' | 'dedupeKey'>> &
    Pick<MemorySignal, 'id' | 'dedupeKey'>,
): MemorySignal {
  const { id, dedupeKey, ...details } = overrides

  return {
    organizationId: 'org-1',
    siteId: 'site-1',
    category: 'fragility',
    trigger: { type: 'staleness', reason: 'object_aging' },
    severity: 'warning',
    importance: 'normal',
    urgency: 'week',
    state: 'active',
    actionability: 'investigate',
    origin: 'rules',
    facts: [],
    rules: [],
    sources: [source],
    actions: [],
    confidence: null,
    detectedAt: '2026-07-25T08:00:00+11:00',
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    ...details,
    id,
    dedupeKey,
  }
}

function detector<TContext>(
  id: string,
  output: MemorySignal[],
): MemorySignalDetector<TContext> {
  return {
    id,
    version: '1',
    detect: () => output,
  }
}

describe('runSignalDetectors', () => {
  it('retourne une collection vide sans détecteur', () => {
    expect(runSignalDetectors([], '2026-07-25T09:00:00+11:00')).toEqual([])
  })

  it('exécute un détecteur avec son contexte et la date de référence', () => {
    const calls: unknown[] = []
    const registered: MemorySignalDetector<{ siteId: string }> = {
      id: 'test-detector',
      version: '1',
      detect: (context, now) => {
        calls.push(context, now)
        return [signal({ id: 'one', dedupeKey: 'one' })]
      },
    }

    const result = runSignalDetectors(
      [createSignalDetectorRegistration(registered, { siteId: 'site-1' })],
      '2026-07-25T09:00:00+11:00',
    )

    expect(result).toHaveLength(1)
    expect(calls).toEqual([{ siteId: 'site-1' }, '2026-07-25T09:00:00+11:00'])
  })

  it('concatène les résultats de plusieurs détecteurs sans connaître leur domaine', () => {
    const promiseExpired = signal({
      id: 'expired',
      dedupeKey: 'promise-expired:promise-1',
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_expired' },
    })
    const promiseNeedsConfirmation = signal({
      id: 'follow-up',
      dedupeKey: 'promise-follow-up:promise-2',
      category: 'promise',
      trigger: { type: 'promise', reason: 'promise_without_due_date' },
    })

    const result = runSignalDetectors(
      [
        createSignalDetectorRegistration(detector('expired', [promiseExpired]), {
          kind: 'promise',
        }),
        createSignalDetectorRegistration(detector('follow-up', [promiseNeedsConfirmation]), {
          kind: 'promise',
        }),
      ],
      '2026-07-25T09:00:00+11:00',
    )

    expect(result).toEqual(expect.arrayContaining([promiseExpired, promiseNeedsConfirmation]))
    expect(result).toHaveLength(2)
  })

  it('dédoublonne uniquement par dedupeKey en conservant le signal le plus sévère', () => {
    const warning = signal({ id: 'warning', dedupeKey: 'same', severity: 'warning' })
    const critical = signal({
      id: 'critical',
      dedupeKey: 'same',
      severity: 'critical',
    })
    const sameTitleDifferentKey = signal({
      id: 'different',
      dedupeKey: 'different',
      severity: 'warning',
    })

    const result = runSignalDetectors(
      [
        createSignalDetectorRegistration(
          detector('duplicates', [warning, critical, sameTitleDifferentKey]),
          null,
        ),
      ],
      '2026-07-25T09:00:00+11:00',
    )

    expect(result).toEqual([critical, sameTitleDifferentKey])
  })

  it('départage un doublon par importance puis par date de détection récente', () => {
    const normal = signal({
      id: 'normal',
      dedupeKey: 'same',
      importance: 'normal',
      detectedAt: '2026-07-25T10:00:00+11:00',
    })
    const high = signal({
      id: 'high',
      dedupeKey: 'same',
      importance: 'high',
      detectedAt: '2026-07-25T08:00:00+11:00',
    })
    const highRecent = signal({
      id: 'high-recent',
      dedupeKey: 'same',
      importance: 'high',
      detectedAt: '2026-07-25T11:00:00+11:00',
    })

    expect(
      runSignalDetectors(
        [
          createSignalDetectorRegistration(
            detector('ranking', [normal, high, highRecent]),
            undefined,
          ),
        ],
        '2026-07-25T12:00:00+11:00',
      ),
    ).toEqual([highRecent])
  })

  it('trie de manière déterministe et conserve le même objet sans le muter', () => {
    const first = signal({ id: 'first', dedupeKey: 'b', severity: 'info' })
    const second = signal({ id: 'second', dedupeKey: 'a', severity: 'critical' })
    const input = [first, second]
    const before = structuredClone(input)

    const firstRun = runSignalDetectors(
      [createSignalDetectorRegistration(detector('stable', input), null)],
      '2026-07-25T09:00:00+11:00',
    )
    const secondRun = runSignalDetectors(
      [createSignalDetectorRegistration(detector('stable', input), null)],
      '2026-07-25T09:00:00+11:00',
    )

    expect(firstRun).toEqual(secondRun)
    expect(firstRun).toEqual([second, first])
    expect(firstRun[0]).toBe(second)
    expect(firstRun[1]).toBe(first)
    expect(input).toEqual(before)
  })

  it('ne modifie pas les signaux produits par les détecteurs', () => {
    const produced = signal({ id: 'produced', dedupeKey: 'produced' })
    const before = structuredClone(produced)

    runSignalDetectors(
      [createSignalDetectorRegistration(detector('immutable', [produced]), null)],
      '2026-07-25T09:00:00+11:00',
    )

    expect(produced).toEqual(before)
  })

  it('choisit le même doublon selon son identifiant en cas d’égalité complète', () => {
    const first = signal({ id: 'z-signal', dedupeKey: 'same' })
    const second = signal({ id: 'a-signal', dedupeKey: 'same' })

    const result = runSignalDetectors(
      [createSignalDetectorRegistration(detector('tie', [first, second]), null)],
      '2026-07-25T09:00:00+11:00',
    )

    expect(result).toEqual([second])
  })
})
