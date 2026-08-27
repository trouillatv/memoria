import { describe, it, expect } from 'vitest'
import { deriveOccurrenceStateStatus } from '@/lib/documents/subject-state'

// R-1 — statut tri-state d'UNE occurrence atomique (groupe state_key).
// Contrat : conflit interne → unknown (jamais open>resolved ni resolved>open) ; missing ≠ conflict.

describe('deriveOccurrenceStateStatus', () => {
  it('resolved univoque (que du done/informational)', () => {
    expect(deriveOccurrenceStateStatus(['done'])).toEqual({ status: 'resolved', reason: 'univocal' })
    expect(deriveOccurrenceStateStatus(['done', 'done', 'informational'])).toEqual({ status: 'resolved', reason: 'univocal' })
  })

  it('open univoque (que du open/in_progress/non_compliant)', () => {
    expect(deriveOccurrenceStateStatus(['open'])).toEqual({ status: 'open', reason: 'univocal' })
    expect(deriveOccurrenceStateStatus(['in_progress', 'non_compliant'])).toEqual({ status: 'open', reason: 'univocal' })
  })

  it('conflit resolved ET open → unknown (reason conflict), JAMAIS resolved ni open', () => {
    expect(deriveOccurrenceStateStatus(['done', 'in_progress'])).toEqual({ status: 'unknown', reason: 'conflict' })
    // le cas OCEF réel : majorité done + qq in_progress/non_compliant → toujours unknown, pas resolved
    expect(deriveOccurrenceStateStatus(['done', 'done', 'done', 'in_progress', 'non_compliant', 'done', 'planned']))
      .toEqual({ status: 'unknown', reason: 'conflict' })
  })

  it('aucun signal exploitable (tout null/inconnu) → unknown (reason missing)', () => {
    expect(deriveOccurrenceStateStatus([null])).toEqual({ status: 'unknown', reason: 'missing' })
    expect(deriveOccurrenceStateStatus([null, null])).toEqual({ status: 'unknown', reason: 'missing' })
    expect(deriveOccurrenceStateStatus(['zzz-inconnu'])).toEqual({ status: 'unknown', reason: 'missing' })
  })

  it('missing et conflict sont distingués (diagnostic), les deux restent unknown pour le moteur', () => {
    const missing = deriveOccurrenceStateStatus([null])
    const conflict = deriveOccurrenceStateStatus(['done', 'open'])
    expect(missing.status).toBe('unknown')
    expect(conflict.status).toBe('unknown')
    expect(missing.reason).not.toBe(conflict.reason)
  })

  it('null mêlé à un signal univoque n\'introduit pas de conflit', () => {
    expect(deriveOccurrenceStateStatus(['done', null])).toEqual({ status: 'resolved', reason: 'univocal' })
    expect(deriveOccurrenceStateStatus([null, 'open'])).toEqual({ status: 'open', reason: 'univocal' })
  })

  it('témoin Bella : « réalisé » (done) → resolved ; « à refaire » (open) → open', () => {
    expect(deriveOccurrenceStateStatus(['done']).status).toBe('resolved')
    expect(deriveOccurrenceStateStatus(['open']).status).toBe('open')
  })
})
