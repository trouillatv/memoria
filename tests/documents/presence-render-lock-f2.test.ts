import { describe, it, expect } from 'vitest'
import { mapMeetingToCrBecib, type MeetingParticipant, type MeetingInput } from '@/lib/documents/meeting-to-cr-becib'
import { crBecibSchema } from '@/lib/documents/cr-becib-schema'

// Lot F2 — verrou de RENDU. P/AE/AN reste le vocabulaire canonique INTERNE ;
// on interdit uniquement « absence de preuve → P ». Un CR ne doit jamais
// affirmer « Présent » quand la présence est absente/indéterminée.

function input(participants: MeetingParticipant[]): MeetingInput {
  return {
    report: { createdAt: '2026-01-01T00:00:00Z', participants },
    site: {}, contract: {}, actions: [], contacts: [],
  }
}
const presenceOf = (p: MeetingParticipant) => mapMeetingToCrBecib(input([p])).intervenants[0]!.presence

describe('F2 — la présence prouvée est conservée (P reste le code interne)', () => {
  it('1. presence="P" → reste "P"', () => {
    expect(presenceOf({ name: 'A', presence: 'P' })).toBe('P')
  })
  it('2. presence="AE" → reste "AE"', () => {
    expect(presenceOf({ name: 'A', presence: 'AE' })).toBe('AE')
  })
  it('3. presence="AN" → reste "AN"', () => {
    expect(presenceOf({ name: 'A', presence: 'AN' })).toBe('AN')
  })
})

describe('F2 — aucune présence FABRIQUÉE quand l’information manque', () => {
  it('4. presence absente (undefined) → null (aucun P fabriqué)', () => {
    expect(presenceOf({ name: 'A' })).toBeNull()
  })
  it('5. presence=null → null', () => {
    expect(presenceOf({ name: 'A', presence: null })).toBeNull()
  })
  it('6. invité + diffusion SANS présence → jamais "présent"', () => {
    const p = presenceOf({ name: 'A', invite: true, diffusion: true })
    expect(p).toBeNull()
    expect(p).not.toBe('P')
    // les axes invité/diffusion sont indépendants et n’impliquent pas la présence
    const iv = mapMeetingToCrBecib(input([{ name: 'A', invite: true, diffusion: true }])).intervenants[0]!
    expect(iv.invite).toBe(true)
    expect(iv.diffusion).toBe(true)
  })
})

describe('F2 — défaut de PARSE : champ présence manquant/invalide → null, jamais P', () => {
  it('intervenant sans presence → null (schema .nullable().catch(null))', () => {
    const cr = crBecibSchema.parse({ meta: {}, intervenants: [{ representant: 'X' }] })
    expect(cr.intervenants[0]!.presence).toBeNull()
  })
  it('presence invalide → null (jamais coerce vers P)', () => {
    const cr = crBecibSchema.parse({ meta: {}, intervenants: [{ representant: 'X', presence: 'BOGUS' }] })
    expect(cr.intervenants[0]!.presence).toBeNull()
  })
  it('presence="P" explicite → conservée', () => {
    const cr = crBecibSchema.parse({ meta: {}, intervenants: [{ representant: 'X', presence: 'P' }] })
    expect(cr.intervenants[0]!.presence).toBe('P')
  })
})
