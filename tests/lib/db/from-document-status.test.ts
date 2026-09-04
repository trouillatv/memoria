// Test UNITAIRE — P1-4A-D2. Mapping document_status → signal d'état (fonction pure, aucune DB).
// Invariant central : `cancelled` (abandon/annulation) ne produit JAMAIS COMPLETED ni un
// accomplissement. Le vocabulaire n'ayant pas de CANCELLED, `cancelled` → NO_STATE_SIGNAL
// (exclusion de la projection), jamais OPEN/STILL_OPEN non plus.

import { describe, it, expect } from 'vitest'
import { fromDocumentStatus } from '@/lib/db/object-state-occurrence-signal'

describe('fromDocumentStatus — cancelled ≠ completed (P1-4A-D2)', () => {
  it('done → COMPLETED', () => {
    expect(fromDocumentStatus('done')).toBe('COMPLETED')
  })

  it('cancelled → NO_STATE_SIGNAL (jamais COMPLETED)', () => {
    expect(fromDocumentStatus('cancelled')).toBe('NO_STATE_SIGNAL')
    expect(fromDocumentStatus('cancelled')).not.toBe('COMPLETED')
  })

  it('cancelled → jamais un accomplissement ni un état ouvert', () => {
    const s = fromDocumentStatus('cancelled')
    expect(['COMPLETED', 'OPENED', 'STILL_OPEN', 'PROGRESS', 'REOPENED']).not.toContain(s)
  })

  it('non-régression des autres document_status', () => {
    expect(fromDocumentStatus('in_progress')).toBe('PROGRESS')
    expect(fromDocumentStatus('non_compliant')).toBe('STILL_OPEN')
    expect(fromDocumentStatus('awaiting_validation')).toBe('STILL_OPEN')
    expect(fromDocumentStatus('planned')).toBe('OPENED')
    expect(fromDocumentStatus('open')).toBe('STILL_OPEN')
    expect(fromDocumentStatus('inconnu')).toBe('NO_STATE_SIGNAL')
  })

  it('seul `done` peut produire COMPLETED via cette voie déterministe', () => {
    for (const s of ['cancelled', 'in_progress', 'non_compliant', 'awaiting_validation', 'planned', 'open', 'x']) {
      expect(fromDocumentStatus(s)).not.toBe('COMPLETED')
    }
  })
})
