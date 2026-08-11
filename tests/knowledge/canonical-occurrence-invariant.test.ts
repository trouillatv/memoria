// Invariant Fact Ledger — Lot 4.
//
// Garanties testées :
//   1. mapProposalStatusToValidation : mapping exhaustif statut → validation_status.
//   2. Invariant sémantique : dismissed = rejeté mais conservé, superseded = observé mais conservé.
//   3. Aucun statut inconnu ne produit 'confirmed' sans preuve explicite.

import { describe, it, expect } from 'vitest'
import { mapProposalStatusToValidation } from '@/lib/db/canonical-subject-reconcile'

describe('mapProposalStatusToValidation', () => {
  it("proposed → observed (fait extrait, pas encore arbitré)", () => {
    expect(mapProposalStatusToValidation('proposed')).toBe('observed')
  })

  it("confirmed → confirmed (validé explicitement par l'humain)", () => {
    expect(mapProposalStatusToValidation('confirmed')).toBe('confirmed')
  })

  it("fulfilled → confirmed (objet matérialisé = validation implicite)", () => {
    expect(mapProposalStatusToValidation('fulfilled')).toBe('confirmed')
  })

  it("superseded → observed (remplacé par plus récent, mais le fait existait)", () => {
    expect(mapProposalStatusToValidation('superseded')).toBe('observed')
  })

  it("dismissed → rejected (l'humain a refusé, le fait reste dans le ledger)", () => {
    expect(mapProposalStatusToValidation('dismissed')).toBe('rejected')
  })

  it("statut inconnu → observed par défaut (jamais confirmed par défaut)", () => {
    expect(mapProposalStatusToValidation('unknown_future_status')).toBe('observed')
  })
})

describe('invariant sémantique du Fact Ledger', () => {
  it("seuls confirmed et fulfilled produisent 'confirmed'", () => {
    const all = ['proposed', 'confirmed', 'fulfilled', 'superseded', 'dismissed']
    const confirmedOnly = all.filter((s) => mapProposalStatusToValidation(s) === 'confirmed')
    expect(confirmedOnly).toEqual(['confirmed', 'fulfilled'])
  })

  it("dismissed est le seul statut produisant 'rejected'", () => {
    const all = ['proposed', 'confirmed', 'fulfilled', 'superseded', 'dismissed']
    const rejected = all.filter((s) => mapProposalStatusToValidation(s) === 'rejected')
    expect(rejected).toEqual(['dismissed'])
  })

  it("proposed et superseded produisent tous les deux 'observed' — ils restent dans le ledger", () => {
    expect(mapProposalStatusToValidation('proposed')).toBe('observed')
    expect(mapProposalStatusToValidation('superseded')).toBe('observed')
  })
})
