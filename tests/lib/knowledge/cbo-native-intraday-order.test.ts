// P3-3b — ordre des événements NATIFS intra-journée. Le natif conserve son occurred_at complet
// (via assembleCboEvents) ; deux natifs opposés le même jour sont ordonnés par l'heure au lieu de
// produire un faux conflict. Le documentaire reste au jour (doctrine inchangée).
import { describe, it, expect } from 'vitest'
import { assembleCboEvents, reduceCboLifecycle, type CboNativeJournalEvent } from '@/lib/knowledge/cbo-lifecycle-reducer'

const nat = (kind: string, occurredAt: string): CboNativeJournalEvent => ({ kind, occurredAt })
const reduceNat = (natives: CboNativeJournalEvent[]) => reduceCboLifecycle(assembleCboEvents('Obligation', [], [], natives).events)

describe('P3-3b — ordre intra-journée des événements natifs', () => {
  it('A. completed 09:00 → reopened 14:00 (même jour) → native_reopened', () => {
    const r = reduceNat([nat('completed', '2026-09-05T09:00:00Z'), nat('reopened', '2026-09-05T14:00:00Z')])
    expect(r.computedCurrentState).toBe('native_reopened')
    expect(r.conflicts).toHaveLength(0)
  })

  it('B. reopened 09:00 → completed 14:00 (même jour) → native_completed', () => {
    const r = reduceNat([nat('reopened', '2026-09-05T09:00:00Z'), nat('completed', '2026-09-05T14:00:00Z')])
    expect(r.computedCurrentState).toBe('native_completed')
    expect(r.conflicts).toHaveLength(0)
  })

  it('C. completed J1 → reopened J2 (jours différents) → native_reopened (inchangé)', () => {
    const r = reduceNat([nat('completed', '2026-09-05T09:00:00Z'), nat('reopened', '2026-09-06T09:00:00Z')])
    expect(r.computedCurrentState).toBe('native_reopened')
  })

  it('D. native_completed puis doc_open ultérieur → native_completed + divergence (inchangé)', () => {
    const asm = assembleCboEvents('Obligation', [{ memberId: 'm1', docId: 'docA', date: '2026-12-01' }], [], [nat('completed', '2026-09-05T09:00:00Z')])
    const r = reduceCboLifecycle(asm.events)
    expect(r.computedCurrentState).toBe('native_completed')
    expect(r.documentaryDivergences.length).toBeGreaterThan(0)
  })

  it('E. doc completed + doc open même date métier → conflict (doctrine documentaire inchangée)', () => {
    const r = reduceCboLifecycle([
      { kind: 'doc_completion', attestedAt: '2025-05-23', eventAt: '2025-05-23' },
      { kind: 'doc_open', attestedAt: '2025-05-23', eventAt: '2025-05-23' },
    ])
    expect(r.computedCurrentState).toBe('conflict')
  })

  it('F. completed → reopened → completed (même jour, heures croissantes) → dernier gouverne (native_completed)', () => {
    const r = reduceNat([
      nat('completed', '2026-09-05T09:00:00Z'),
      nat('reopened', '2026-09-05T10:00:00Z'),
      nat('completed', '2026-09-05T11:00:00Z'),
    ])
    expect(r.computedCurrentState).toBe('native_completed')
  })

  it('G. horodatage IDENTIQUE, polarités opposées → conflict (aucun ordre démontrable)', () => {
    const r = reduceNat([nat('completed', '2026-09-05T09:00:00.000Z'), nat('reopened', '2026-09-05T09:00:00.000Z')])
    expect(r.computedCurrentState).toBe('conflict')
  })

  it('H. non-régression : un natif seul reste cohérent (completed → native_completed)', () => {
    expect(reduceNat([nat('completed', '2026-09-05T09:00:00Z')]).computedCurrentState).toBe('native_completed')
    expect(reduceNat([nat('reopened', '2026-09-05T09:00:00Z')]).computedCurrentState).toBe('native_reopened')
  })

  it('created reste exclu même avec horodatage complet', () => {
    const asm = assembleCboEvents('Obligation', [{ memberId: 'm1', docId: 'docA', date: '2025-03-27' }], [], [nat('created', '2026-09-03T05:10:30Z')])
    const r = reduceCboLifecycle(asm.events)
    expect(r.computedCurrentState).toBe('open') // doc_open du membre seulement ; created ignoré
  })
})
