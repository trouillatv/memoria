// #228 Lot B — doctrine de l'éligibilité à la stagnation.
// stagnant = évolution ATTENDUE (objet opérationnel ouvert OU reopened) qui n'arrive pas.
// open seul ne suffit pas ; la famille ne décide pas ; actor jamais.

import { describe, it, expect } from 'vitest'
import { isStagnationEligible, isOpenOperationalObjectStatus } from './stagnation'

describe('isStagnationEligible', () => {
  it('business + objet opérationnel ouvert → éligible', () => {
    expect(isStagnationEligible('business_subject', true, false)).toBe(true)
  })
  it('business + reopened → éligible', () => {
    expect(isStagnationEligible('business_subject', false, true)).toBe(true)
  })
  it('business SANS objet ni reopened → NON éligible (resolved/knowledge/observation unknown ancien)', () => {
    // couvre : business resolved sans objet même après 300 j ; knowledge pur sans objet ;
    // observation unknown sans objet — « ancien » n'est pas « stagnant ».
    expect(isStagnationEligible('business_subject', false, false)).toBe(false)
  })
  it('durableKind=null (legacy) suit la même règle (attente prouvée requise)', () => {
    expect(isStagnationEligible(null, false, false)).toBe(false)
    expect(isStagnationEligible(null, true, false)).toBe(true)
  })
  it('actor → JAMAIS éligible, même avec objet ouvert ET reopened', () => {
    expect(isStagnationEligible('actor', true, true)).toBe(false)
  })
})

describe('isOpenOperationalObjectStatus', () => {
  it('action open/planned → ouvert', () => {
    expect(isOpenOperationalObjectStatus('site_action', 'open')).toBe(true)
    expect(isOpenOperationalObjectStatus('site_action', 'planned')).toBe(true)
    expect(isOpenOperationalObjectStatus('site_action', 'done')).toBe(false)
  })
  it('réserve open → ouvert', () => {
    expect(isOpenOperationalObjectStatus('site_reserve', 'open')).toBe(true)
    expect(isOpenOperationalObjectStatus('site_reserve', 'closed')).toBe(false)
  })
  it('deadline to_plan/planned → ouvert', () => {
    expect(isOpenOperationalObjectStatus('site_deadline', 'to_plan')).toBe(true)
    expect(isOpenOperationalObjectStatus('site_deadline', 'done')).toBe(false)
  })
  it('décision proposee → ouvert', () => {
    expect(isOpenOperationalObjectStatus('site_decision', 'proposee')).toBe(true)
  })
  it('type inconnu / null → non ouvert', () => {
    expect(isOpenOperationalObjectStatus('autre', 'open')).toBe(false)
    expect(isOpenOperationalObjectStatus('site_action', null)).toBe(false)
  })
})
