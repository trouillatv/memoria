import { describe, expect, it } from 'vitest'
import { primaryProvenanceKind } from '@/lib/knowledge/action-provenance'

// ── Lot 4 · Slice 5 — la source primaire est DÉTERMINISTE et structurelle ────
const cols = (o: Partial<Parameters<typeof primaryProvenanceKind>[0]>) =>
  ({ reserveId: null, reportId: null, sourceCaptureId: null, subjectId: null, ...o })

describe('primaryProvenanceKind — cause directe d’abord, ordre stable', () => {
  it('la réserve prime sur tout (action corrective)', () => {
    expect(primaryProvenanceKind(cols({ reserveId: 'r', reportId: 'rep', sourceCaptureId: 'c', subjectId: 's' }))).toBe('reserve')
  })
  it('sinon le report (réunion/visite d’origine)', () => {
    expect(primaryProvenanceKind(cols({ reportId: 'rep', sourceCaptureId: 'c', subjectId: 's' }))).toBe('report')
  })
  it('sinon la capture terrain', () => {
    expect(primaryProvenanceKind(cols({ sourceCaptureId: 'c', subjectId: 's' }))).toBe('capture')
  })
  it('sinon le sujet', () => {
    expect(primaryProvenanceKind(cols({ subjectId: 's' }))).toBe('subject')
  })
  it('aucune relation → aucune provenance (jamais inventée)', () => {
    expect(primaryProvenanceKind(cols({}))).toBeNull()
  })
})
