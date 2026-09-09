import { describe, expect, it } from 'vitest'
import {
  buildFoundingUnits,
  classifyTrackabilityContent,
  decideFoundingOld,
  decideFoundingV2,
  relevanceOf,
  type FoundingUnitsInput,
  type PropRow,
} from './tracked-point-founding'

function prop(overrides: Partial<PropRow> & { proposal_family: string }): PropRow {
  return {
    id: overrides.id ?? `prop-${Math.random().toString(36).slice(2)}`,
    proposal_family: overrides.proposal_family,
    document_status: overrides.document_status ?? null,
    label: overrides.label ?? 'label',
    subject_thread_id: overrides.subject_thread_id ?? 'thread-1',
    document_id: overrides.document_id ?? null,
    extraction_run_id: overrides.extraction_run_id ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    review_status: overrides.review_status ?? null,
    source_payload: overrides.source_payload ?? null,
  }
}

describe('decideFoundingOld — doctrine Phase 5E (frozen)', () => {
  it('CONFIRMED quand un unique CBO fonde le thread, peu importe les props', () => {
    expect(decideFoundingOld([], 'cbo-1')).toEqual({ kind: 'CONFIRMED', cboId: 'cbo-1' })
  })

  it('NO_POINT_EMPTY_THREAD quand aucune proposition et aucun CBO', () => {
    expect(decideFoundingOld([], null)).toEqual({ kind: 'NO_POINT_EMPTY_THREAD' })
  })

  it('PROVISIONAL triggerFamily=decision prime sur tout le reste', () => {
    const props = [prop({ proposal_family: 'decision' }), prop({ proposal_family: 'action' })]
    expect(decideFoundingOld(props, null)).toEqual({ kind: 'PROVISIONAL', triggerFamily: 'decision' })
  })

  it('PROVISIONAL triggerFamily=reservation si pas de decision', () => {
    const props = [prop({ proposal_family: 'reservation' })]
    expect(decideFoundingOld(props, null)).toEqual({ kind: 'PROVISIONAL', triggerFamily: 'reservation' })
  })

  it('PROVISIONAL triggerFamily=observation seulement si une observation est encore open', () => {
    const open = [prop({ proposal_family: 'observation', document_status: 'open' })]
    expect(decideFoundingOld(open, null)).toEqual({ kind: 'PROVISIONAL', triggerFamily: 'observation' })

    const resolved = [prop({ proposal_family: 'observation', document_status: 'done' })]
    expect(decideFoundingOld(resolved, null).kind).not.toBe('PROVISIONAL')
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM si uniquement du knowledge_fact avec au moins une résolution', () => {
    const props = [
      prop({ proposal_family: 'knowledge_fact', document_status: 'done' }),
      prop({ proposal_family: 'knowledge_fact', document_status: null }),
    ]
    expect(decideFoundingOld(props, null)).toEqual({ kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' })
  })

  it('NO_POINT_KNOWLEDGE_ONLY si uniquement du knowledge_fact sans aucune résolution', () => {
    const props = [prop({ proposal_family: 'knowledge_fact', document_status: null })]
    expect(decideFoundingOld(props, null)).toEqual({ kind: 'NO_POINT_KNOWLEDGE_ONLY' })
  })

  it('UNCOVERED_FAMILY_COMBINATION pour toute combinaison hors des branches ci-dessus', () => {
    const props = [prop({ proposal_family: 'action' })]
    expect(decideFoundingOld(props, null)).toEqual({ kind: 'UNCOVERED_FAMILY_COMBINATION', families: ['action'] })
  })
})

describe('classifyTrackabilityContent — doctrine V2 (frozen)', () => {
  it('UNDETERMINED sur un ensemble vide', () => {
    expect(classifyTrackabilityContent([])).toBe('UNDETERMINED')
  })

  it('ACTOR_ONLY si toutes les props sont person/company', () => {
    expect(classifyTrackabilityContent([prop({ proposal_family: 'person' }), prop({ proposal_family: 'company' })])).toBe('ACTOR_ONLY')
  })

  it('RESOLUTION_SIGNAL_ONLY si toutes les props sont résolues', () => {
    const props = [prop({ proposal_family: 'action', document_status: 'done' })]
    expect(classifyTrackabilityContent(props)).toBe('RESOLUTION_SIGNAL_ONLY')
  })

  it('TRACKABLE_CONDITION si une action/deadline/planning a une pertinence strong ou medium', () => {
    const props = [prop({ proposal_family: 'action', document_status: null, source_payload: { relevanceScore: 'strong' } })]
    expect(classifyTrackabilityContent(props)).toBe('TRACKABLE_CONDITION')
  })

  it('TEMPORAL_ONLY si seules des deadlines faibles sont actionnables', () => {
    const props = [prop({ proposal_family: 'deadline', document_status: null, source_payload: { relevanceScore: 'weak' } })]
    expect(classifyTrackabilityContent(props)).toBe('TEMPORAL_ONLY')
  })

  it('CONTEXT_ONLY si des familles actionnables existent sans pertinence qualifiante', () => {
    const props = [prop({ proposal_family: 'planning', document_status: null, source_payload: null })]
    expect(classifyTrackabilityContent(props)).toBe('CONTEXT_ONLY')
  })

  it('relevanceOf lit source_payload.relevanceScore et tolère son absence', () => {
    expect(relevanceOf(prop({ proposal_family: 'action', source_payload: { relevanceScore: 'medium' } }))).toBe('medium')
    expect(relevanceOf(prop({ proposal_family: 'action', source_payload: null }))).toBeNull()
  })
})

describe('decideFoundingV2 — dérive uniquement les UNCOVERED_FAMILY_COMBINATION de V1', () => {
  it('retourne le kind V1 tel quel quand V1 conclut sans passer par UNCOVERED', () => {
    const props = [prop({ proposal_family: 'decision' })]
    expect(decideFoundingV2(props, null)).toEqual({ outcome: { kind: 'PROVISIONAL', triggerFamily: 'decision' } })
  })

  it('PROVISIONAL_TRACKABLE quand V1 est UNCOVERED et la trackability est TRACKABLE_CONDITION', () => {
    const props = [prop({ proposal_family: 'action', source_payload: { relevanceScore: 'strong' } })]
    expect(decideFoundingV2(props, null)).toEqual({
      outcome: { kind: 'PROVISIONAL_TRACKABLE', trackability: 'TRACKABLE_CONDITION' },
      trackability: 'TRACKABLE_CONDITION',
    })
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY quand V1 est UNCOVERED et tout est résolu', () => {
    const props = [prop({ proposal_family: 'action', document_status: 'done' })]
    expect(decideFoundingV2(props, null).outcome).toEqual({ kind: 'RESOLUTION_WITHOUT_KNOWN_PROBLEM_TRACKABILITY' })
  })

  it('EXCLUDED_ACTOR_CONTEXT_TEMPORAL pour CONTEXT_ONLY/ACTOR_ONLY/TEMPORAL_ONLY', () => {
    const props = [prop({ proposal_family: 'person' })]
    expect(decideFoundingV2(props, null).outcome).toEqual({ kind: 'EXCLUDED_ACTOR_CONTEXT_TEMPORAL', trackability: 'ACTOR_ONLY' })
  })

  it('NO_POINT_EMPTY_THREAD reste inchangé par V2 (court-circuite avant UNCOVERED)', () => {
    expect(decideFoundingV2([], null).outcome).toEqual({ kind: 'NO_POINT_EMPTY_THREAD' })
  })

  it('PENDING_TRACKABILITY quand V1 est UNCOVERED et la trackability est UNDETERMINED', () => {
    const props = [prop({ proposal_family: 'company' }), prop({ proposal_family: 'knowledge_fact', document_status: null })]
    expect(decideFoundingV2(props, null)).toEqual({ outcome: { kind: 'PENDING_TRACKABILITY' }, trackability: 'UNDETERMINED' })
  })
})

describe('buildFoundingUnits — scope thread vs proposal_set (frozen)', () => {
  it('produit une unité scope=thread par thread quand au plus un CBO couvre le thread', () => {
    const input: FoundingUnitsInput = {
      threads: [{ threadId: 't1', label: 'Sujet 1' }],
      propsByThread: new Map([['t1', [prop({ id: 'p1', proposal_family: 'decision', subject_thread_id: 't1' })]]]),
      threadToCbos: new Map(),
      proposalToCbos: new Map(),
    }
    const units = buildFoundingUnits(input)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ threadId: 't1', scope: 'thread', outcomeOld: 'PROVISIONAL' })
  })

  it('CONFIRMED via le CBO unique du thread même sans proposition matérialisée', () => {
    const input: FoundingUnitsInput = {
      threads: [{ threadId: 't1', label: 'Sujet 1' }],
      propsByThread: new Map(),
      threadToCbos: new Map([['t1', new Set(['cbo-1'])]]),
      proposalToCbos: new Map(),
    }
    const units = buildFoundingUnits(input)
    expect(units).toHaveLength(1)
    expect(units[0].outcomeV2).toEqual({ kind: 'CONFIRMED', cboId: 'cbo-1' })
  })

  it('éclate en scope=proposal_set par CBO + un seau orphan quand plusieurs CBO couvrent le même thread', () => {
    const p1 = prop({ id: 'p1', proposal_family: 'decision', subject_thread_id: 't1' })
    const p2 = prop({ id: 'p2', proposal_family: 'reservation', subject_thread_id: 't1' })
    const pOrphan = prop({ id: 'p3', proposal_family: 'action', subject_thread_id: 't1' })
    const input: FoundingUnitsInput = {
      threads: [{ threadId: 't1', label: 'Sujet multi-CBO' }],
      propsByThread: new Map([['t1', [p1, p2, pOrphan]]]),
      threadToCbos: new Map([['t1', new Set(['cbo-a', 'cbo-b'])]]),
      proposalToCbos: new Map([
        ['p1', new Set(['cbo-a'])],
        ['p2', new Set(['cbo-b'])],
      ]),
    }
    const units = buildFoundingUnits(input)
    expect(units).toHaveLength(3)
    const byProposalSetOf = new Map(units.map((u) => [u.proposalSetOf, u]))
    expect(byProposalSetOf.get('cbo:cbo-a')).toMatchObject({ scope: 'proposal_set', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-a' } })
    expect(byProposalSetOf.get('cbo:cbo-b')).toMatchObject({ scope: 'proposal_set', outcomeV2: { kind: 'CONFIRMED', cboId: 'cbo-b' } })
    expect(byProposalSetOf.get('orphan')).toMatchObject({ scope: 'proposal_set', props: [pOrphan] })
  })

  it('ne produit aucune unité orphan quand toutes les propositions sont rattachées à un CBO', () => {
    const p1 = prop({ id: 'p1', proposal_family: 'decision', subject_thread_id: 't1' })
    const input: FoundingUnitsInput = {
      threads: [{ threadId: 't1', label: 'Sujet multi-CBO' }],
      propsByThread: new Map([['t1', [p1]]]),
      threadToCbos: new Map([['t1', new Set(['cbo-a', 'cbo-b'])]]),
      proposalToCbos: new Map([['p1', new Set(['cbo-a'])]]),
    }
    const units = buildFoundingUnits(input)
    expect(units).toHaveLength(1)
    expect(units[0].proposalSetOf).toBe('cbo:cbo-a')
  })
})
