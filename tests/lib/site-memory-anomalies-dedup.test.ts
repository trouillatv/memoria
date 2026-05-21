// Vincent 2026-05-21 — tests purs du helper processAnomaliesForMemory.
//
// 4 cas demandés :
//   1. Même texte intervention.notes / anomaly.description → 1 seule ligne
//   2. 4 anomalies materiel_casse sans description même jour → 1 ligne « 4 signalements »
//   3. Anomalies même catégorie mais descriptions différentes → pas de collapse
//   4. Anomalies même catégorie mais jours différents → pas de collapse

import { describe, it, expect } from 'vitest'
import {
  processAnomaliesForMemory,
  type AnomalyInputRow,
} from '@/lib/db/site-memory'

function anomaly(overrides: Partial<AnomalyInputRow>): AnomalyInputRow {
  return {
    id: overrides.id ?? 'a-1',
    intervention_id: overrides.intervention_id ?? 'i-1',
    description: overrides.description ?? null,
    category: overrides.category ?? 'materiel_casse',
    category_other: overrides.category_other ?? null,
    status: overrides.status ?? 'open',
    created_at: overrides.created_at ?? '2026-05-20T10:00:00.000Z',
    resolved_at: overrides.resolved_at ?? null,
  }
}

describe('processAnomaliesForMemory — dedup A + collapse B', () => {
  // ────────────────────────── CAS 1 ──────────────────────────

  it('dédoublonne quand description anomaly = note intervention sur la même intervention', () => {
    const notes = new Map<string, string>([['i-1', 'sols glissants couloir a']])
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          intervention_id: 'i-1',
          description: 'Sols glissants couloir A',
        }),
      ],
      interventionNotesById: notes,
      excludeAnomalyIds: new Set(),
    })
    expect(out).toEqual([])
  })

  it('ne dédoublonne pas si description anomaly diffère de la note intervention', () => {
    const notes = new Map<string, string>([['i-1', 'sols glissants couloir a']])
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          intervention_id: 'i-1',
          description: 'Sols glissants couloir B', // différent
        }),
      ],
      interventionNotesById: notes,
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('a-1')
  })

  it('ne dédoublonne pas si description match une note d\'AUTRE intervention', () => {
    const notes = new Map<string, string>([['i-2', 'sols glissants couloir a']])
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          intervention_id: 'i-1', // pas i-2
          description: 'Sols glissants couloir A',
        }),
      ],
      interventionNotesById: notes,
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(1)
  })

  it('dédup tolère case + espaces (normalize lower + trim)', () => {
    const notes = new Map<string, string>([['i-1', 'eau coupée bloc b']])
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          intervention_id: 'i-1',
          description: '  EAU COUPÉE BLOC B  ',
        }),
      ],
      interventionNotesById: notes,
      excludeAnomalyIds: new Set(),
    })
    expect(out).toEqual([])
  })

  // ────────────────────────── CAS 2 ──────────────────────────

  it('collapse 4 anomalies materiel_casse sans description même jour en 1 ligne', () => {
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1', intervention_id: 'i-1', created_at: '2026-05-20T08:00:00.000Z' }),
        anomaly({ id: 'a-2', intervention_id: 'i-2', created_at: '2026-05-20T10:00:00.000Z' }),
        anomaly({ id: 'a-3', intervention_id: 'i-3', created_at: '2026-05-20T12:00:00.000Z' }),
        anomaly({ id: 'a-4', intervention_id: 'i-4', created_at: '2026-05-20T18:00:00.000Z' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('group::2026-05-20::materiel_casse')
    expect(out[0]?.title).toBe('materiel casse — 4 signalements')
    expect(out[0]?.meta?.grouped).toBe(true)
    expect(out[0]?.meta?.groupedCount).toBe(4)
    // occurredAt = la plus récente du groupe (chrono inversée côté UI)
    expect(out[0]?.occurredAt).toBe('2026-05-20T18:00:00.000Z')
    // lien vers la 1ère intervention du groupe
    expect(out[0]?.interventionId).toBe('i-1')
  })

  it('singleton anomalie générique : push normal (pas de collapse forcé)', () => {
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1', category: 'eau_coupee' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('a-1')
    expect(out[0]?.title).toBe('eau_coupee')
    expect(out[0]?.meta?.grouped).toBeUndefined()
  })

  // ────────────────────────── CAS 3 ──────────────────────────

  it('ne collapse PAS quand descriptions libres sont différentes', () => {
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          category: 'materiel_casse',
          description: 'Aspirateur bloc A en panne',
          created_at: '2026-05-20T08:00:00.000Z',
        }),
        anomaly({
          id: 'a-2',
          category: 'materiel_casse',
          description: 'Mop bloc B abîmé',
          created_at: '2026-05-20T14:00:00.000Z',
        }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.meta?.grouped !== true)).toBe(true)
  })

  it('ne collapse PAS si UNE des anomalies a une description (autres génériques restent individuelles)', () => {
    // Doctrine : on collapse SEULEMENT les génériques. Celle qui a desc reste à part.
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({
          id: 'a-1',
          category: 'materiel_casse',
          description: 'Aspirateur HS',
          created_at: '2026-05-20T08:00:00.000Z',
        }),
        anomaly({ id: 'a-2', created_at: '2026-05-20T10:00:00.000Z' }),
        anomaly({ id: 'a-3', created_at: '2026-05-20T12:00:00.000Z' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(2)
    const rich = out.find((e) => e.id === 'a-1')
    const grouped = out.find((e) => e.meta?.grouped === true)
    expect(rich).toBeDefined()
    expect(rich?.title).toBe('Aspirateur HS')
    expect(grouped).toBeDefined()
    expect(grouped?.meta?.groupedCount).toBe(2)
  })

  // ────────────────────────── CAS 4 ──────────────────────────

  it('ne collapse PAS des anomalies même catégorie sur des jours différents', () => {
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1', category: 'eau_coupee', created_at: '2026-05-20T10:00:00.000Z' }),
        anomaly({ id: 'a-2', category: 'eau_coupee', created_at: '2026-05-21T10:00:00.000Z' }),
        anomaly({ id: 'a-3', category: 'eau_coupee', created_at: '2026-05-22T10:00:00.000Z' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(out).toHaveLength(3)
    expect(out.every((e) => e.meta?.grouped !== true)).toBe(true)
  })

  // ────────────────────────── Bonus : exclusions ──────────────────────────

  it('respecte excludeAnomalyIds (ex. incidents d\'accès)', () => {
    const out = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1' }),
        anomaly({ id: 'a-2' }),
        anomaly({ id: 'a-3' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(['a-2']),
    })
    // 2 restants : a-1 et a-3 → collapse car même cat même jour
    expect(out).toHaveLength(1)
    expect(out[0]?.meta?.groupedCount).toBe(2)
  })

  it('status collapsed : resolved si TOUS resolved, open sinon', () => {
    const outAllResolved = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1', status: 'resolved' }),
        anomaly({ id: 'a-2', status: 'resolved' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(outAllResolved[0]?.status).toBe('resolved')

    const outMixed = processAnomaliesForMemory({
      anomalies: [
        anomaly({ id: 'a-1', status: 'resolved' }),
        anomaly({ id: 'a-2', status: 'open' }),
      ],
      interventionNotesById: new Map(),
      excludeAnomalyIds: new Set(),
    })
    expect(outMixed[0]?.status).toBe('open')
  })
})
