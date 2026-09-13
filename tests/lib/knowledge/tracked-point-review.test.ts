import { describe, expect, it } from 'vitest'
import {
  computeTrackedPointReviewFingerprint,
  isTrackedPointReviewed,
  type TrackedPointReviewSignalInput,
} from '@/lib/knowledge/tracked-point-review'

const NONE: TrackedPointReviewSignalInput = {
  reopened: null,
  needsYou: null,
  changedSinceLastPv: null,
  lingering: null,
  canonicalAttention: null,
}

describe('computeTrackedPointReviewFingerprint — aucune raison active', () => {
  it('retourne null quand rien n’est actif (rien à revoir)', () => {
    expect(computeTrackedPointReviewFingerprint(NONE)).toBeNull()
  })

  it('needsYou avec questionIds vide n’active pas le segment', () => {
    expect(computeTrackedPointReviewFingerprint({ ...NONE, needsYou: { questionIds: [] } })).toBeNull()
  })

  it('canonicalAttention avec signals vide n’active pas le segment', () => {
    expect(computeTrackedPointReviewFingerprint({ ...NONE, canonicalAttention: { signals: [] } })).toBeNull()
  })
})

describe('computeTrackedPointReviewFingerprint — reopened', () => {
  it('encode la date d’évolution significative', () => {
    const fp = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: '2026-03-01' } })
    expect(fp).toBe('reopened:2026-03-01')
  })

  it('encode « unknown » quand latestMeaningfulEventAt est null (cas RUS confirmé), jamais une valeur implicite', () => {
    const fp = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: null } })
    expect(fp).toBe('reopened:unknown')
  })

  it('avant/après : une nouvelle preuve (nouvelle date) change le fingerprint → redevient à revoir', () => {
    const before = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: '2026-03-01' } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: '2026-04-15' } })
    expect(before).not.toBe(after)
  })

  it('avant/après : la même date (rien de nouveau) laisse le fingerprint identique → reste déjà revu', () => {
    const before = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: '2026-03-01' } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, reopened: { latestMeaningfulEventAt: '2026-03-01' } })
    expect(before).toBe(after)
  })
})

describe('computeTrackedPointReviewFingerprint — needs_you', () => {
  it('trie les ids de question, indépendamment de l’ordre reçu', () => {
    const a = computeTrackedPointReviewFingerprint({ ...NONE, needsYou: { questionIds: ['q2', 'q1'] } })
    const b = computeTrackedPointReviewFingerprint({ ...NONE, needsYou: { questionIds: ['q1', 'q2'] } })
    expect(a).toBe(b)
    expect(a).toBe('needs_you:q1+q2')
  })

  it('avant/après : une nouvelle question MemorIA change le fingerprint', () => {
    const before = computeTrackedPointReviewFingerprint({ ...NONE, needsYou: { questionIds: ['q1'] } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, needsYou: { questionIds: ['q1', 'q2'] } })
    expect(before).not.toBe(after)
  })
})

describe('computeTrackedPointReviewFingerprint — changed_since_last_pv', () => {
  it('encode la date du dernier PV', () => {
    const fp = computeTrackedPointReviewFingerprint({ ...NONE, changedSinceLastPv: { lastPvDate: '2026-05-10' } })
    expect(fp).toBe('changed_since_last_pv:2026-05-10')
  })

  it('avant/après : un nouveau PV où le Point change à nouveau produit un fingerprint différent', () => {
    const before = computeTrackedPointReviewFingerprint({ ...NONE, changedSinceLastPv: { lastPvDate: '2026-05-10' } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, changedSinceLastPv: { lastPvDate: '2026-06-01' } })
    expect(before).not.toBe(after)
  })
})

describe('computeTrackedPointReviewFingerprint — lingering', () => {
  it('encode évolution + dernier PV, jamais un compteur temporel (daysSince/passagesSince ne font pas partie du contrat)', () => {
    const fp = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: '2026-01-01', lastPvDate: '2026-06-01' },
    })
    expect(fp).toBe('lingering:2026-01-01:2026-06-01')
  })

  it('encode « unknown » quand latestMeaningfulEventAt est null', () => {
    const fp = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: null, lastPvDate: '2026-06-01' },
    })
    expect(fp).toBe('lingering:unknown:2026-06-01')
  })

  it('avant/après : un simple passage supplémentaire sans nouveau PV daté ne change RIEN (reste déjà revu)', () => {
    // Le seul moyen de faire varier ce segment est evtAt/lastPvDate — un Point qui « traîne »
    // davantage (jours en plus) sans nouveau PV garde exactement la même paire de dates.
    const before = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: '2026-01-01', lastPvDate: '2026-06-01' },
    })
    const after = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: '2026-01-01', lastPvDate: '2026-06-01' },
    })
    expect(before).toBe(after)
  })

  it('avant/après : un nouveau PV du chantier change le fingerprint → redevient à revoir', () => {
    const before = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: '2026-01-01', lastPvDate: '2026-06-01' },
    })
    const after = computeTrackedPointReviewFingerprint({
      ...NONE,
      lingering: { latestMeaningfulEventAt: '2026-01-01', lastPvDate: '2026-07-01' },
    })
    expect(before).not.toBe(after)
  })
})

describe('computeTrackedPointReviewFingerprint — canonical_attention', () => {
  it('trie les signaux, indépendamment de l’ordre reçu, et n’inclut jamais le score', () => {
    const a = computeTrackedPointReviewFingerprint({
      ...NONE,
      canonicalAttention: { signals: ['pv_reopened', 'action_overdue'] },
    })
    const b = computeTrackedPointReviewFingerprint({
      ...NONE,
      canonicalAttention: { signals: ['action_overdue', 'pv_reopened'] },
    })
    expect(a).toBe(b)
    expect(a).toBe('canonical_attention:action_overdue+pv_reopened')
  })

  it('avant/après : une recalibration de score interne ne peut pas changer le fingerprint (le type n’expose aucun score)', () => {
    // Le contrat exclut structurellement le score : deux items avec les MÊMES signaux mais des
    // scores différents produisent, par construction, le même fingerprint.
    const before = computeTrackedPointReviewFingerprint({ ...NONE, canonicalAttention: { signals: ['stagnant'] } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, canonicalAttention: { signals: ['stagnant'] } })
    expect(before).toBe(after)
  })

  it('avant/après : un nouveau signal (changement de classe métier) change le fingerprint', () => {
    const before = computeTrackedPointReviewFingerprint({ ...NONE, canonicalAttention: { signals: ['stagnant'] } })
    const after = computeTrackedPointReviewFingerprint({ ...NONE, canonicalAttention: { signals: ['stagnant', 'pv_aggrave'] } })
    expect(before).not.toBe(after)
  })
})

describe('computeTrackedPointReviewFingerprint — composition multi-raisons', () => {
  it('trie les segments par type, jamais par ordre d’apparition à l’écran', () => {
    const fp = computeTrackedPointReviewFingerprint({
      reopened: { latestMeaningfulEventAt: '2026-03-01' },
      needsYou: { questionIds: ['q1'] },
      changedSinceLastPv: null,
      lingering: null,
      canonicalAttention: { signals: ['stagnant'] },
    })
    expect(fp).toBe('canonical_attention:stagnant|needs_you:q1|reopened:2026-03-01')
  })
})

describe('isTrackedPointReviewed', () => {
  it('true seulement si le fingerprint courant existe et est strictement identique au stocké', () => {
    expect(isTrackedPointReviewed('reopened:2026-03-01', 'reopened:2026-03-01')).toBe(true)
    expect(isTrackedPointReviewed('reopened:2026-03-01', 'reopened:2026-04-01')).toBe(false)
    expect(isTrackedPointReviewed('reopened:2026-03-01', undefined)).toBe(false)
  })

  it('un Point sans raison active (fingerprint null) n’est jamais « déjà revu »', () => {
    expect(isTrackedPointReviewed(null, undefined)).toBe(false)
    expect(isTrackedPointReviewed(null, 'reopened:2026-03-01')).toBe(false)
  })
})
