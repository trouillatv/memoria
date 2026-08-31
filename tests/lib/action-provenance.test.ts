import { describe, expect, it } from 'vitest'
import {
  primaryProvenanceKind, reportProvenanceType, mobileSourceHref, cardProvenanceLine,
} from '@/lib/knowledge/action-provenance'

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

// ── Provenance mobile (GO Vincent, 2026-09-01) — vérité de type + routes /m ───
describe('reportProvenanceType — origin SEUL (jamais le titre)', () => {
  it("origin='import' → PV / document historique (PAS une visite)", () => {
    expect(reportProvenanceType('import')).toBe('pv')
  })
  it('origine terrain (planned/spontaneous/qr/gps) → visite', () => {
    for (const o of ['planned', 'spontaneous', 'qr', 'gps']) expect(reportProvenanceType(o)).toBe('visite')
  })
  it('origin null → réunion', () => {
    expect(reportProvenanceType(null)).toBe('reunion')
  })
})

describe('mobileSourceHref — jamais de route desktop', () => {
  it('réunion → /m/reunion/<id>', () => {
    expect(mobileSourceHref('reunion', { siteId: 's1', reportId: 'r1' })).toBe('/m/reunion/r1')
  })
  it('visite → /m/visite/<id>', () => {
    expect(mobileSourceHref('visite', { siteId: 's1', reportId: 'r1' })).toBe('/m/visite/r1')
  })
  it('réserve → liste réserves /m du chantier', () => {
    expect(mobileSourceHref('reserve', { siteId: 's1', reportId: null })).toBe('/m/site/s1/reserves')
  })
  it('PV et sujet → pas de route /m fiable → null (libellé sans lien)', () => {
    expect(mobileSourceHref('pv', { siteId: 's1', reportId: 'r1' })).toBeNull()
    expect(mobileSourceHref('sujet', { siteId: 's1', reportId: null })).toBeNull()
  })
  it('report manquant → pas de lien', () => {
    expect(mobileSourceHref('visite', { siteId: 's1', reportId: null })).toBeNull()
  })
})

describe('cardProvenanceLine — compacte, déterministe (type + date)', () => {
  it('PV', () => {
    expect(cardProvenanceLine({ kind: 'source', type: 'pv', dateLabel: '25 août 2026' })).toBe('Issue du PV du 25 août 2026')
  })
  it('visite', () => {
    expect(cardProvenanceLine({ kind: 'source', type: 'visite', dateLabel: '30 août 2026' })).toBe('Issue de la visite du 30 août 2026')
  })
  it('réunion', () => {
    expect(cardProvenanceLine({ kind: 'source', type: 'reunion', dateLabel: '18 août 2026' })).toBe('Issue du CR de réunion du 18 août 2026')
  })
  it('sujet → nom (pas de date)', () => {
    expect(cardProvenanceLine({ kind: 'source', type: 'sujet', dateLabel: null, name: 'Étanchéité toiture' })).toBe('Issue du sujet : Étanchéité toiture')
  })
  it('création manuelle', () => {
    expect(cardProvenanceLine({ kind: 'manual' })).toBe('Créée manuellement')
  })
  it('sans date → forme sans « du … »', () => {
    expect(cardProvenanceLine({ kind: 'source', type: 'pv', dateLabel: null })).toBe('Issue du PV')
  })
})
