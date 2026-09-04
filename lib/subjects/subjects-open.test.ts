// Sentinelles — lot subjectsOpen P0
//
// Gate : SUBJECTS_OPEN_P0_PASS ou FAIL.
//
// Cas couverts :
//  1. isProvenOpen — tri-state=open → true
//  2. isProvenOpen — tri-state=unknown + objet actif → true (Cadenas/Eau/PETRO)
//  3. isProvenOpen — tri-state=unknown + 0 objet → false (garde critique)
//  4. isProvenOpen — tri-state=resolved + 0 objet → false
//  5. isProvenOpen — tri-state=resolved + objet actif → true (orphelin — garde non bloquant)
//
// Sentinelles métier :
//  A. Cadenas (6801ce5c) — terrain, field_checked, 1 action open + 1 deadline to_plan → IN
//  B. Eau (1d41b3f1) — terrain, field_checked, 1 action open → IN
//  C. Planning (14cd6eaa) — terrain, field_checked, 0 objet → OUT
//  D. OCEF Regard R4 — PV résolu (resolved), 0 objet actif → OUT
//
//  Garde critique :
//  E. field_checked (unknown) sans objet actif → isProvenOpen = false
//
//  Séquence SUBJECTS_OPEN_P0_PASS si A+B+C+D+E tous corrects.

import { describe, it, expect } from 'vitest'
import { isProvenOpen } from '@/lib/documents/subject-state'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'

function makeSubject(overrides: Partial<NavigableSubjectSummary>): NavigableSubjectSummary {
  return {
    canonicalSubjectId: 'cs-test',
    title: 'Sujet test',
    aliases: [],
    durableKind: 'business_subject',
    dominantFamily: 'action',
    currentStatus: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: '2026-07-01',
    lastMeaningfulChangeAt: '2026-01-01',
    pvCount: 3,
    threadCount: 1,
    nativeOccurrenceCount: 0,
    activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    isStagnant: false,
    stagnationDays: 0,
    consecutiveMentionsWithoutChange: 0,
    terrainObjects: [],
    currentTriState: 'unknown',
    displayState: 'unknown',
    provenOpen: false,
    activeObjectsCboAware: 0,
    ...overrides,
  }
}

// ── Cas unitaires isProvenOpen ────────────────────────────────────────────────

describe('isProvenOpen — cas unitaires', () => {
  it('tri-state=open → true', () => {
    expect(isProvenOpen('open', 0)).toBe(true)
  })

  it('tri-state=open + objets → true', () => {
    expect(isProvenOpen('open', 3)).toBe(true)
  })

  it('tri-state=unknown + objet actif → true', () => {
    expect(isProvenOpen('unknown', 1)).toBe(true)
  })

  it('tri-state=unknown + 0 objet → false (garde critique)', () => {
    expect(isProvenOpen('unknown', 0)).toBe(false)
  })

  it('tri-state=resolved + 0 objet → false', () => {
    expect(isProvenOpen('resolved', 0)).toBe(false)
  })

  it('tri-state=resolved + objet actif → true (possible si objet non clôturé)', () => {
    expect(isProvenOpen('resolved', 2)).toBe(true)
  })
})

// ── Sentinelles métier ────────────────────────────────────────────────────────

describe('Sentinelle A — Cadenas PETRO (terrain, field_checked, 1 action + 1 deadline)', () => {
  it('isProvenOpen = true → IN', () => {
    const s = makeSubject({
      canonicalSubjectId: '6801ce5c',
      title: 'Cadenas',
      currentStatus: 'field_checked',
      currentTriState: 'unknown',
      activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 1, decisionsOpen: 0, total: 2 },
    })
    expect(isProvenOpen(s.currentTriState, s.activeObjects.total)).toBe(true)
  })
})

describe('Sentinelle B — Eau PETRO (terrain, field_checked, 1 action open)', () => {
  it('isProvenOpen = true → IN', () => {
    const s = makeSubject({
      canonicalSubjectId: '1d41b3f1',
      title: 'Eau',
      currentStatus: 'field_checked',
      currentTriState: 'unknown',
      activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 1 },
    })
    expect(isProvenOpen(s.currentTriState, s.activeObjects.total)).toBe(true)
  })
})

describe('Sentinelle C — Planning PETRO (terrain, field_checked, 0 objet)', () => {
  it('isProvenOpen = false → OUT', () => {
    const s = makeSubject({
      canonicalSubjectId: '14cd6eaa',
      title: 'Planning',
      currentStatus: 'field_checked',
      currentTriState: 'unknown',
      activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    })
    expect(isProvenOpen(s.currentTriState, s.activeObjects.total)).toBe(false)
  })
})

describe('Sentinelle D — OCEF Regard R4 (PV résolu, 0 objet actif)', () => {
  it('tri-state=resolved + 0 objet → OUT', () => {
    const s = makeSubject({
      canonicalSubjectId: '4fb967c3',
      title: 'Regard R4',
      currentStatus: 'done',
      currentTriState: 'resolved',
      activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    })
    expect(isProvenOpen(s.currentTriState, s.activeObjects.total)).toBe(false)
  })
})

describe('Sentinelle E — garde critique field_checked sans objet', () => {
  it('field_checked (unknown) + 0 objet → false', () => {
    const s = makeSubject({
      currentStatus: 'field_checked',
      currentTriState: 'unknown',
      activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 },
    })
    expect(isProvenOpen(s.currentTriState, s.activeObjects.total)).toBe(false)
  })
})

// ── Séquence gate ─────────────────────────────────────────────────────────────

describe('SUBJECTS_OPEN_P0 — gate complet', () => {
  it('Cadenas IN + Eau IN + Planning OUT + OCEF OUT + garde critique OK → SUBJECTS_OPEN_P0_PASS', () => {
    const cadenas = makeSubject({ currentTriState: 'unknown', activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 1, decisionsOpen: 0, total: 2 } })
    const eau     = makeSubject({ currentTriState: 'unknown', activeObjects: { actionsOpen: 1, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 1 } })
    const planning = makeSubject({ currentTriState: 'unknown', activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 } })
    const ocef    = makeSubject({ currentStatus: 'done', currentTriState: 'resolved', activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 } })
    const garde   = makeSubject({ currentStatus: 'field_checked', currentTriState: 'unknown', activeObjects: { actionsOpen: 0, reservesOpen: 0, deadlinesActive: 0, decisionsOpen: 0, total: 0 } })

    expect(isProvenOpen(cadenas.currentTriState,  cadenas.activeObjects.total)).toBe(true)   // IN
    expect(isProvenOpen(eau.currentTriState,      eau.activeObjects.total)).toBe(true)        // IN
    expect(isProvenOpen(planning.currentTriState, planning.activeObjects.total)).toBe(false)  // OUT
    expect(isProvenOpen(ocef.currentTriState,     ocef.activeObjects.total)).toBe(false)      // OUT
    expect(isProvenOpen(garde.currentTriState,    garde.activeObjects.total)).toBe(false)     // garde
  })
})
