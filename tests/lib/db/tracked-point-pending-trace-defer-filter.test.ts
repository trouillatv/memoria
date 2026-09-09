// Test UNITAIRE (aucune DB) — Phase 6E.8A, primitives pures exportées par
// lib/db/tracked-point-pending-resolution.ts : DEFER_DURATION_DAYS et
// pendingTraceVisibleFilter. Volontairement séparé du fichier d'intégration
// tracked-point-pending-resolution.test.ts (qui exige une vraie Supabase) pour rester
// exécutable en CI (projet vitest "unit") sans dépendre de la migration 399.

import { describe, it, expect } from 'vitest'
import { DEFER_DURATION_DAYS, pendingTraceVisibleFilter } from '@/lib/db/tracked-point-pending-resolution'

describe('DEFER_DURATION_DAYS', () => {
  it('expose exactement les 3 durées fixes mandatées (1, 7, 30 jours)', () => {
    expect(DEFER_DURATION_DAYS).toEqual([1, 7, 30])
  })
})

describe('pendingTraceVisibleFilter', () => {
  it('produit le filtre OR Supabase attendu pour un nowIso donné', () => {
    const nowIso = '2026-09-09T12:00:00.000Z'
    expect(pendingTraceVisibleFilter(nowIso)).toBe(
      'deferred_until.is.null,deferred_until.lte.2026-09-09T12:00:00.000Z',
    )
  })

  it('reste stable pour un nowIso différent (pas de valeur codée en dur)', () => {
    const nowIso = '2030-01-01T00:00:00.000Z'
    expect(pendingTraceVisibleFilter(nowIso)).toBe(
      'deferred_until.is.null,deferred_until.lte.2030-01-01T00:00:00.000Z',
    )
  })
})
