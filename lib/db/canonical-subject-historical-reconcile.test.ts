import { describe, it, expect } from 'vitest'
import { FAMILY_TO_KIND } from '@/lib/db/canonical-subject-historical-reconcile'
import { CAN_CREATE_SUBJECT_KINDS } from '@/lib/db/canonical-subject-source-reconcile'
import type { DocumentProposalFamily } from '@/types/db'

// P0-J.1 — verrouille le mapping document_extraction_proposal.proposal_family
// → vocabulaire "kind" du moteur canonique. Ce mapping est la seule pièce de
// logique métier réellement nouvelle de ce lot (le reste réutilise le moteur
// déjà testé de canonical-subject-source-reconcile.ts) : il doit rester une
// convention explicite et testée, jamais implicite.

describe('P0-J.1 — mapping proposal_family → kind (FAMILY_TO_KIND)', () => {
  it('action → action', () => {
    expect(FAMILY_TO_KIND.action).toBe('action')
  })

  it('decision → decision', () => {
    expect(FAMILY_TO_KIND.decision).toBe('decision')
  })

  it('knowledge_fact → knowledge', () => {
    expect(FAMILY_TO_KIND.knowledge_fact).toBe('knowledge')
  })

  it('deadline → deadline (rattachement seul, jamais de création)', () => {
    expect(FAMILY_TO_KIND.deadline).toBe('deadline')
    // La doctrine "deadline ne crée jamais" vit dans CAN_CREATE_SUBJECT_KINDS
    // (canonical-subject-source-reconcile.ts) : ce test verrouille que le kind
    // mappé pour 'deadline' est bien celui-là même que CAN_CREATE_SUBJECT_KINDS exclut.
    expect(CAN_CREATE_SUBJECT_KINDS.has(FAMILY_TO_KIND.deadline as string)).toBe(false)
  })

  it('observation → vigilance', () => {
    expect(FAMILY_TO_KIND.observation).toBe('vigilance')
  })

  it('reservation → vigilance', () => {
    expect(FAMILY_TO_KIND.reservation).toBe('vigilance')
  })

  it('person et company sont hors périmètre (déjà canonicalisés comme acteurs)', () => {
    expect(FAMILY_TO_KIND.person).toBeUndefined()
    expect(FAMILY_TO_KIND.company).toBeUndefined()
  })

  it('les kinds créables (action, decision, knowledge, vigilance) restent dans CAN_CREATE_SUBJECT_KINDS', () => {
    const creatableFamilies: DocumentProposalFamily[] = ['action', 'decision', 'knowledge_fact', 'observation', 'reservation']
    for (const family of creatableFamilies) {
      const kind = FAMILY_TO_KIND[family]
      expect(kind).toBeDefined()
      expect(CAN_CREATE_SUBJECT_KINDS.has(kind as string)).toBe(true)
    }
  })

  it('ne mappe aucune famille inconnue au-delà des 6 familles métier attendues', () => {
    expect(Object.keys(FAMILY_TO_KIND).sort()).toEqual(
      ['action', 'decision', 'deadline', 'knowledge_fact', 'observation', 'reservation'].sort(),
    )
  })
})
