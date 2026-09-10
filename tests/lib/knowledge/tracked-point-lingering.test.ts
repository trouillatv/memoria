import { describe, expect, it } from 'vitest'
import {
  selectLingeringPoints,
  LINGERING_THRESHOLD_DAYS,
  MIN_RELEVANT_PASSAGES,
  RECENT_ACTIVITY_DAYS,
  LINGERING_DISPLAY_CAP,
} from '@/lib/knowledge/tracked-point-lingering'
import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'

function point(overrides: Partial<PointReadModelEntry>): PointReadModelEntry {
  return {
    id: 'p1',
    siteId: 's1',
    ownerCanonicalSubjectId: 'subj-1',
    label: 'Extincteurs hall A',
    status: 'active',
    mergedIntoId: null,
    canonicalPointId: 'p1',
    identityStatus: 'CONFIRMED',
    derivedState: 'open',
    foundingKind: 'cbo',
    foundingSource: null,
    hasUpstreamDefect: false,
    cboIds: [],
    hardMemberThreadIds: [],
    latestMeaningfulEventAt: null,
    trajectory: [],
    stateBasis: [],
    markers: [],
    documentaryDivergences: [],
    conflicts: [],
    toConfirm: false,
    closedByDecision: false,
    awaitingDecision: false,
    hasDocumentaryDivergence: false,
    hasConflict: false,
    ...overrides,
  }
}

function attention(overrides: Partial<CanonicalAttentionItem>): CanonicalAttentionItem {
  return {
    canonicalSubjectId: 'subj-1',
    title: 'Sujet',
    category: 'watch',
    urgency: 'low',
    score: 0,
    signals: [],
    reasons: [],
    href: '/x',
    ...overrides,
  }
}

const TODAY = '2026-09-11'
// Chantier actif récemment (dernier passage à 10 j de TODAY) + ≥ MIN_RELEVANT_PASSAGES
// passages après le 2026-05-01 (largement > LINGERING_THRESHOLD_DAYS avant TODAY).
const OLD_EVENT = '2026-05-01'
const PV_DATES = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

describe('tracked-point-lingering — selectLingeringPoints V3 + départage (pur, aucun recalcul d’état)', () => {
  it('éligible : open, évolution ≥ seuil, passages suffisants, chantier actif', () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT })]
    const result = selectLingeringPoints(points, TODAY, PV_DATES)
    expect(result.map((p) => p.id)).toEqual(['a'])
    expect(result[0].passagesSinceEvent).toBe(PV_DATES.length)
  })

  it('non éligible : résolu ou état inconnu, même avec ancienneté et passages suffisants', () => {
    const points = [
      point({ id: 'a', derivedState: 'resolved', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'b', derivedState: 'unknown', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'c', derivedState: 'conflict', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    expect(selectLingeringPoints(points, TODAY, PV_DATES)).toEqual([])
  })

  it(`non éligible : ancienneté < ${LINGERING_THRESHOLD_DAYS} j`, () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: '2026-09-01' })]
    expect(selectLingeringPoints(points, TODAY, PV_DATES)).toEqual([])
  })

  it(`non éligible : < ${MIN_RELEVANT_PASSAGES} passages depuis l'évolution`, () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT })]
    expect(selectLingeringPoints(points, TODAY, ['2026-08-25'])).toEqual([])
  })

  it('chantier dormant : aucun Point ne traîne même si individuellement éligible', () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT })]
    // Dernier passage bien plus vieux que RECENT_ACTIVITY_DAYS.
    const staleDates = ['2026-01-01', '2026-01-15', '2026-02-01']
    expect(selectLingeringPoints(points, TODAY, staleDates)).toEqual([])
    expect(selectLingeringPoints(points, TODAY, [])).toEqual([])
  })

  it('date d\'évolution inconnue : exclue du bloc principal même avec passages en nombre', () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: null })]
    expect(selectLingeringPoints(points, TODAY, PV_DATES)).toEqual([])
  })

  it('départage : attention canonique medium avant low', () => {
    const points = [
      point({ id: 'low', ownerCanonicalSubjectId: 'cs-low', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'medium', ownerCanonicalSubjectId: 'cs-medium', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    const attentionItems = [
      attention({ canonicalSubjectId: 'cs-low', urgency: 'low' }),
      attention({ canonicalSubjectId: 'cs-medium', urgency: 'medium' }),
    ]
    const result = selectLingeringPoints(points, TODAY, PV_DATES, { attentionItems })
    expect(result.map((p) => p.id)).toEqual(['medium', 'low'])
  })

  it('départage : action confirmée en retard avant non-overdue, à attention égale', () => {
    const points = [
      point({ id: 'plain', ownerCanonicalSubjectId: 'cs-plain', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'overdue', ownerCanonicalSubjectId: 'cs-overdue', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    const attentionItems = [
      attention({ canonicalSubjectId: 'cs-plain', urgency: 'medium', signals: [] }),
      attention({ canonicalSubjectId: 'cs-overdue', urgency: 'medium', signals: ['action_overdue'] }),
    ]
    const result = selectLingeringPoints(points, TODAY, PV_DATES, { attentionItems })
    expect(result.map((p) => p.id)).toEqual(['overdue', 'plain'])
  })

  it('départage : reopened avant open, à attention et retard égaux', () => {
    const points = [
      point({ id: 'open', ownerCanonicalSubjectId: 'cs-1', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'reopened', ownerCanonicalSubjectId: 'cs-1', derivedState: 'reopened', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    const result = selectLingeringPoints(points, TODAY, PV_DATES)
    expect(result.map((p) => p.id)).toEqual(['reopened', 'open'])
  })

  it('départage : nombre d\'actions ouvertes liées, à attention/retard/état égaux', () => {
    const points = [
      point({ id: 'few', ownerCanonicalSubjectId: 'cs-few', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'many', ownerCanonicalSubjectId: 'cs-many', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    const openActionCountBySubject = new Map([
      ['cs-few', 1],
      ['cs-many', 4],
    ])
    const result = selectLingeringPoints(points, TODAY, PV_DATES, { openActionCountBySubject })
    expect(result.map((p) => p.id)).toEqual(['many', 'few'])
  })

  it('départage : ancienneté sans changement (le plus vieux d\'abord), tous les autres signaux égaux', () => {
    const points = [
      point({ id: 'recent', ownerCanonicalSubjectId: 'cs-recent', derivedState: 'open', latestMeaningfulEventAt: '2026-06-01' }),
      point({ id: 'oldest', ownerCanonicalSubjectId: 'cs-oldest', derivedState: 'open', latestMeaningfulEventAt: '2026-01-01' }),
    ]
    const result = selectLingeringPoints(points, TODAY, PV_DATES)
    expect(result.map((p) => p.id)).toEqual(['oldest', 'recent'])
    // Même chantier (mêmes passages), donc même dénominateur : l'ordre par ancienneté
    // entraîne mécaniquement le même ordre par nombre de passages traversés (critère 6).
    expect(result[0].passagesSinceEvent).toBeGreaterThanOrEqual(result[1].passagesSinceEvent)
  })

  it('ordre stable en égalité complète : libellé alphabétique comme départage technique', () => {
    const points = [
      point({ id: 'z', label: 'Zone de stockage', ownerCanonicalSubjectId: 'cs-z', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'a', label: 'Allée dégagée', ownerCanonicalSubjectId: 'cs-a', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
      point({ id: 'm', label: 'Marquage sol', ownerCanonicalSubjectId: 'cs-m', derivedState: 'open', latestMeaningfulEventAt: OLD_EVENT }),
    ]
    const result = selectLingeringPoints(points, TODAY, PV_DATES)
    expect(result.map((p) => p.id)).toEqual(['a', 'm', 'z'])
  })

  it(`plafonne l'affichage à ${LINGERING_DISPLAY_CAP} Points après tri`, () => {
    const points = Array.from({ length: 25 }, (_, i) =>
      point({
        id: `p${i}`,
        label: `Point ${String(i).padStart(2, '0')}`,
        ownerCanonicalSubjectId: `cs-${i}`,
        derivedState: 'open',
        latestMeaningfulEventAt: OLD_EVENT,
      }),
    )
    const result = selectLingeringPoints(points, TODAY, PV_DATES)
    expect(result).toHaveLength(LINGERING_DISPLAY_CAP)
    expect(result.map((p) => p.id)).toEqual(points.slice(0, LINGERING_DISPLAY_CAP).map((p) => p.id))
  })

  it(`chantier actif : dernier passage à ${RECENT_ACTIVITY_DAYS} j pile reste actif`, () => {
    const points = [point({ id: 'a', derivedState: 'open', latestMeaningfulEventAt: '2026-01-01' })]
    const boundaryDate = '2026-07-13' // exactement RECENT_ACTIVITY_DAYS j avant TODAY (2026-09-11)
    const result = selectLingeringPoints(points, TODAY, ['2026-02-01', '2026-04-01', '2026-06-01', boundaryDate])
    expect(result.map((p) => p.id)).toEqual(['a'])
  })
})
