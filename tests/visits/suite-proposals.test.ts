// Mig 194 — mappage pur suites de visite ↔ site_report_proposals (le stockage
// des réunions). Le point critique : le KIND visite (action/reserve/surveiller)
// doit survivre à l'aller-retour via payload.kind, car la colonne `type` ne
// connaît que les types réunion (reserve→anomaly, surveiller→vigilance).

import { describe, it, expect } from 'vitest'
import {
  toProposalRows,
  proposalVisitKind,
  proposalCaptureId,
  proposalExcerpt,
  truncateExcerpt,
} from '@/lib/visits/suite-proposals'
import type { DetectedSuite } from '@/services/ai/visit-suites'

const SITE = '00000000-0000-0000-0000-000000000001'

describe('toProposalRows — projection visite → proposition réunion', () => {
  const detected: DetectedSuite[] = [
    { sourceId: 'cap-1', kind: 'action', text: 'Reprendre le câblage brûlé' },
    { sourceId: 'cap-1', kind: 'reserve', text: 'Suies persistantes zone cuisson' },
    { sourceId: 'cap-2', kind: 'surveiller', text: 'Odeur réserve froide' },
  ]
  const bodies = new Map([
    ['cap-1', 'le câblage est brûlé au fond, et il reste des suies partout en zone cuisson'],
    ['cap-2', 'odeur bizarre dans la réserve froide, à revoir'],
  ])
  const rows = toProposalRows(detected, SITE, bodies)

  it('projette chaque kind sur un type réunion valide (contrainte CHECK mig 099)', () => {
    expect(rows.map((r) => r.type)).toEqual(['action', 'anomaly', 'vigilance'])
  })

  it('le kind visite survit dans payload.kind (aller-retour sans perte)', () => {
    expect(rows.map((r) => proposalVisitKind(r.payload))).toEqual(['action', 'reserve', 'surveiller'])
  })

  it('capture_id et extrait source sont portés par le payload', () => {
    expect(proposalCaptureId(rows[0].payload)).toBe('cap-1')
    expect(proposalCaptureId(rows[2].payload)).toBe('cap-2')
    expect(proposalExcerpt(rows[2].payload)).toContain('réserve froide')
  })

  it('le libellé proposé est la formulation détectée, site rattaché', () => {
    expect(rows[0].short_label).toBe('Reprendre le câblage brûlé')
    expect(rows.every((r) => r.site_id === SITE)).toBe(true)
  })

  it('une capture source inconnue donne un extrait null (jamais inventé)', () => {
    const orphan = toProposalRows(
      [{ sourceId: 'cap-x', kind: 'action', text: 'X' }], SITE, new Map(),
    )
    expect(proposalExcerpt(orphan[0].payload)).toBeNull()
  })
})

describe('proposalVisitKind — discrimine visite vs réunion', () => {
  it('renvoie null pour un payload de proposition RÉUNION (pas de kind visite)', () => {
    expect(proposalVisitKind({ title: 'Relancer le plombier' })).toBeNull()
    expect(proposalVisitKind({ kind: 'client_memory' })).toBeNull()
    expect(proposalVisitKind(null)).toBeNull()
    expect(proposalVisitKind('action')).toBeNull()
  })
})

describe('truncateExcerpt', () => {
  it('tronque à ~120 caractères avec ellipse', () => {
    const long = 'a'.repeat(200)
    const out = truncateExcerpt(long)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('…')).toBe(true)
  })
  it('laisse un texte court intact', () => {
    expect(truncateExcerpt('  porte RF30 à revoir ')).toBe('porte RF30 à revoir')
  })
})
