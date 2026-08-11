import { describe, it, expect } from 'vitest'
import { computeNativeChangeMetrics } from '@/lib/knowledge/evolution-metrics'
import type { NativeOccurrence } from '@/lib/knowledge/evolution-metrics'

// Helpers
const fv = (date: string, visitStatus: string | null = null): NativeOccurrence => ({
  sourceKind: 'field_visit',
  effectiveDate: date,
  visitStatus,
  documentStatus: null,
})

const meeting = (date: string, visitStatus: string | null = null): NativeOccurrence => ({
  sourceKind: 'meeting',
  effectiveDate: date,
  visitStatus,
  documentStatus: null,
})

describe('computeNativeChangeMetrics', () => {
  it('liste vide → tout à null/0', () => {
    const r = computeNativeChangeMetrics([], null)
    expect(r.lastMeaningfulChangeAt).toBeNull()
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
    expect(r.stagnationDays).toBe(0)
    expect(r.isStagnant).toBe(false)
  })

  it('une seule occurrence → LMCA = sa date, 0 repetitions', () => {
    const r = computeNativeChangeMetrics([fv('2026-07-20')], '2026-07-20')
    expect(r.lastMeaningfulChangeAt).toBe('2026-07-20')
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
    expect(r.stagnationDays).toBe(0)
  })

  // ─── CAS PETRO "Diffusion et mise à jour du planning général" (V1 limite assumée) ─────

  it('PETRO planning — 20/07 + 11/08, tous statuts null → LMCA = 20/07 (V1 limite)', () => {
    // 2 preuves le 20/07, 7 preuves le 11/08 — tous visitStatus=null (historique sans statut)
    const occs: NativeOccurrence[] = [
      fv('2026-07-20'), fv('2026-07-20'),
      fv('2026-08-11'), fv('2026-08-11'), fv('2026-08-11'),
      fv('2026-08-11'), fv('2026-08-11'), fv('2026-08-11'), fv('2026-08-11'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-08-11')
    // V1 : pas de changement de statut détecté → LMCA reste sur la première date
    expect(r.lastMeaningfulChangeAt).toBe('2026-07-20')
    // 2 événements (20/07 et 11/08), le 11/08 ne change pas le statut → 1 mention sans changement
    expect(r.consecutiveMentionsWithoutChange).toBe(1)
    expect(r.stagnationDays).toBe(22) // 11/08 - 20/07 = 22 jours
    expect(r.isStagnant).toBe(false) // < 30 jours
  })

  // ─── Changement de statut détecté ────────────────────────────────────────────

  it('changement de statut 20/07 → 11/08 : LMCA = 11/08', () => {
    const occs: NativeOccurrence[] = [
      fv('2026-07-20', null),
      fv('2026-08-11', 'still_open'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-08-11')
    expect(r.lastMeaningfulChangeAt).toBe('2026-08-11')
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
    expect(r.stagnationDays).toBe(0)
  })

  it('statut réglé après stagnation : LMCA = date de la résolution', () => {
    const occs: NativeOccurrence[] = [
      fv('2026-06-01', 'still_open'),
      fv('2026-07-01', 'still_open'),
      fv('2026-07-15', 'still_open'),
      fv('2026-08-01', 'field_checked'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-08-01')
    expect(r.lastMeaningfulChangeAt).toBe('2026-08-01')
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
  })

  // ─── Déduplication par événement (plusieurs preuves même date) ───────────────

  it('10 preuves sur 4 dates → 4 événements, stagnation calculée sur dates distinctes', () => {
    const occs: NativeOccurrence[] = [
      // 20/07 : 3 preuves, toutes null
      fv('2026-07-20'), fv('2026-07-20'), fv('2026-07-20'),
      // 27/07 : 2 preuves, null
      fv('2026-07-27'), fv('2026-07-27'),
      // 10/08 : 3 preuves, null
      fv('2026-08-10'), fv('2026-08-10'), fv('2026-08-10'),
      // 11/08 : 2 preuves, null
      fv('2026-08-11'), fv('2026-08-11'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-08-11')
    // 4 événements, aucun changement de statut → LMCA = premier = 20/07
    expect(r.lastMeaningfulChangeAt).toBe('2026-07-20')
    // 3 événements après le premier sans changement
    expect(r.consecutiveMentionsWithoutChange).toBe(3)
    // 11/08 - 20/07 = 22 jours
    expect(r.stagnationDays).toBe(22)
    expect(r.isStagnant).toBe(false) // < 30 jours
  })

  it('statut non-null enrichit un événement même si la première preuve était null', () => {
    // Même date : première preuve null, deuxième preuve non-null
    const occs: NativeOccurrence[] = [
      fv('2026-07-20', null),
      fv('2026-07-20', 'still_open'), // même événement, statut plus riche
      fv('2026-08-11', 'still_open'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-08-11')
    // 20/07 est considéré comme 'still_open' → 11/08 ne change pas → LMCA = 20/07
    expect(r.lastMeaningfulChangeAt).toBe('2026-07-20')
    expect(r.consecutiveMentionsWithoutChange).toBe(1)
  })

  it('réunion et visite terrain le même jour = deux événements distincts', () => {
    const occs: NativeOccurrence[] = [
      fv('2026-07-20', null),
      meeting('2026-07-20', 'mentioned'), // sourceKind différent = événement distinct
    ]
    const r = computeNativeChangeMetrics(occs, '2026-07-20')
    // 'null' puis 'mentioned' → changement détecté → LMCA = 20/07 (deuxième événement)
    expect(r.lastMeaningfulChangeAt).toBe('2026-07-20')
    expect(r.consecutiveMentionsWithoutChange).toBe(0)
  })

  // ─── Stagnation ──────────────────────────────────────────────────────────────

  it('stagnation >= 30 jours et >= 2 mentions sans changement → isStagnant = true', () => {
    const occs: NativeOccurrence[] = [
      fv('2026-01-01', 'still_open'),
      fv('2026-02-01', 'still_open'),
      fv('2026-03-01', 'still_open'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-03-01')
    expect(r.lastMeaningfulChangeAt).toBe('2026-01-01')
    expect(r.consecutiveMentionsWithoutChange).toBe(2)
    expect(r.stagnationDays).toBe(59)
    expect(r.isStagnant).toBe(true)
  })

  it('stagnation >= 30 jours mais une seule répétition → isStagnant = false', () => {
    const occs: NativeOccurrence[] = [
      fv('2026-01-01', 'still_open'),
      fv('2026-03-01', 'still_open'),
    ]
    const r = computeNativeChangeMetrics(occs, '2026-03-01')
    expect(r.consecutiveMentionsWithoutChange).toBe(1)
    expect(r.isStagnant).toBe(false) // < 2 répétitions
  })
})
