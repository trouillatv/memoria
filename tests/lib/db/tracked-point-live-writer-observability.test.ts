import { describe, it, expect } from 'vitest'
import {
  groupEventsIntoRuns,
  type LiveWriterEventRow,
} from '@/lib/db/tracked-point-live-writer-observability'

const SITE_A = '11111111-1111-1111-1111-111111111111'
const SITE_B = '22222222-2222-2222-2222-222222222222'
const DOC_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const DOC_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

let seq = 0
function ev(overrides: Partial<LiveWriterEventRow> & { occurredAt: string }): LiveWriterEventRow {
  seq += 1
  return {
    id: `evt-${seq}`,
    siteId: SITE_A,
    unitKey: `unit-${seq}`,
    verdict: 'AUTO_LINKED',
    writePattern: 'ATTACH_MEMBER',
    targetPointId: null,
    replayed: false,
    sourceKind: 'historical_pdf',
    sourceRefId: DOC_1,
    ...overrides,
  }
}

const NAMES = new Map([[SITE_A, 'Chantier A'], [SITE_B, 'Chantier B']])

describe('groupEventsIntoRuns', () => {
  it('regroupe des événements proches du même (site, source, ref) en un seul run', () => {
    const events = [
      ev({ occurredAt: '2026-09-10T10:00:00.000Z' }),
      ev({ occurredAt: '2026-09-10T10:00:05.000Z' }),
      ev({ occurredAt: '2026-09-10T10:00:10.000Z' }),
    ]
    const runs = groupEventsIntoRuns(events, NAMES)
    expect(runs).toHaveLength(1)
    expect(runs[0].unitsProcessed).toBe(3)
    expect(runs[0].startAt).toBe('2026-09-10T10:00:00.000Z')
    expect(runs[0].endAt).toBe('2026-09-10T10:00:10.000Z')
    expect(runs[0].siteName).toBe('Chantier A')
  })

  it('sépare deux occurrences du même (site, source, ref) distantes de plus de gapMs', () => {
    const events = [
      ev({ occurredAt: '2026-09-10T10:00:00.000Z' }),
      ev({ occurredAt: '2026-09-10T10:20:00.000Z' }),
    ]
    const runs = groupEventsIntoRuns(events, NAMES)
    expect(runs).toHaveLength(2)
    expect(runs.every((r) => r.unitsProcessed === 1)).toBe(true)
  })

  it('ne fusionne jamais deux sites ou deux sources différentes, même simultanés', () => {
    const events = [
      ev({ occurredAt: '2026-09-10T10:00:00.000Z', siteId: SITE_A }),
      ev({ occurredAt: '2026-09-10T10:00:00.000Z', siteId: SITE_B }),
      ev({ occurredAt: '2026-09-10T10:00:00.000Z', siteId: SITE_A, sourceRefId: DOC_2 }),
    ]
    const runs = groupEventsIntoRuns(events, NAMES)
    expect(runs).toHaveLength(3)
  })

  it('respecte un gapMs personnalisé', () => {
    const events = [
      ev({ occurredAt: '2026-09-10T10:00:00.000Z' }),
      ev({ occurredAt: '2026-09-10T10:00:30.000Z' }),
    ]
    expect(groupEventsIntoRuns(events, NAMES, undefined, 10_000)).toHaveLength(2)
    expect(groupEventsIntoRuns(events, NAMES, undefined, 60_000)).toHaveLength(1)
  })

  it('signale autoCreatedHigh au-delà du taux, jamais en dessous du seuil de volume', () => {
    const highRateSmall = [
      ev({ occurredAt: '2026-09-10T10:00:00.000Z', verdict: 'AUTO_CREATED' }),
    ]
    expect(groupEventsIntoRuns(highRateSmall, NAMES)[0].anomalies.autoCreatedHigh).toBe(false)

    const highRateLarge = Array.from({ length: 6 }, (_, i) =>
      ev({ occurredAt: `2026-09-10T10:00:0${i}.000Z`, verdict: i < 4 ? 'AUTO_CREATED' : 'AUTO_LINKED' }),
    )
    expect(groupEventsIntoRuns(highRateLarge, NAMES)[0].anomalies.autoCreatedHigh).toBe(true)
  })

  it('signale needsHumanHigh sur un volume absolu élevé même à taux faible', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      ev({ occurredAt: `2026-09-10T10:${String(i).padStart(2, '0')}:00.000Z`, verdict: i < 11 ? 'NEEDS_HUMAN' : 'AUTO_LINKED' }),
    )
    const runs = groupEventsIntoRuns(events, NAMES, undefined, 60 * 60 * 1000)
    expect(runs[0].anomalies.needsHumanHigh).toBe(true)
  })

  it('compte identityUnresolvedCount uniquement pour les événements marqués', () => {
    const e1 = ev({ occurredAt: '2026-09-10T10:00:00.000Z', verdict: 'NEEDS_HUMAN' })
    const e2 = ev({ occurredAt: '2026-09-10T10:00:05.000Z', verdict: 'NEEDS_HUMAN' })
    const runs = groupEventsIntoRuns([e1, e2], NAMES, new Set([e1.id]))
    expect(runs[0].identityUnresolvedCount).toBe(1)
  })

  it('trie les runs du plus récent au plus ancien', () => {
    const events = [
      ev({ occurredAt: '2026-09-10T08:00:00.000Z', siteId: SITE_A }),
      ev({ occurredAt: '2026-09-10T12:00:00.000Z', siteId: SITE_B }),
    ]
    const runs = groupEventsIntoRuns(events, NAMES)
    expect(runs[0].siteId).toBe(SITE_B)
    expect(runs[1].siteId).toBe(SITE_A)
  })

  it('résout le nom de site à défaut via son id', () => {
    const events = [ev({ occurredAt: '2026-09-10T10:00:00.000Z', siteId: 'unknown-site' })]
    const runs = groupEventsIntoRuns(events, NAMES)
    expect(runs[0].siteName).toBe('unknown-site')
  })

  it('liste vide → aucun run', () => {
    expect(groupEventsIntoRuns([], NAMES)).toEqual([])
  })
})
