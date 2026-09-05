import { describe, it, expect } from 'vitest'
import {
  deriveVisitCandidates,
  rankVisitCandidates,
  VISIT_MODE_POLICY,
  type SubjectEnrichment,
} from '@/lib/visits/visit-candidates'
import { watchlistSourceKey } from '@/lib/visits/watchlist-not-applicable-memory'
import type { WatchlistProposal } from '@/lib/visits/watchlist-proposals'
import type { WatchlistItemPriority } from '@/types/db'

function proposal(
  source_kind: string,
  source_ref: string | null,
  priority: WatchlistItemPriority = 'important',
  label = `${source_kind} ${source_ref}`,
): WatchlistProposal {
  return { label, source_kind, source_ref, priority, reason: null }
}

function enrichmentMap(entries: Array<[string, string, SubjectEnrichment]>): Map<string, SubjectEnrichment> {
  return new Map(entries.map(([k, r, e]) => [watchlistSourceKey(k, r), e]))
}

describe('VISIT_MODE_POLICY — politique V1 déterministe', () => {
  it('mappe exactement les 5 source_kinds opérationnels sur 2 modes', () => {
    expect(VISIT_MODE_POLICY).toEqual({
      proof_window_closing: 'field_check',
      reserve_open: 'field_check',
      action_overdue: 'ask_confirm',
      decision_unapplied: 'ask_confirm',
      obligation_neglected: 'ask_confirm',
    })
  })

  it('n’introduit aucun troisième mode', () => {
    const modes = new Set(Object.values(VISIT_MODE_POLICY))
    expect([...modes].sort()).toEqual(['ask_confirm', 'field_check'])
  })
})

describe('deriveVisitCandidates — projection object-first', () => {
  it('field_check pour proof_window_closing et reserve_open', () => {
    const out = deriveVisitCandidates([
      proposal('proof_window_closing', 'pw-1'),
      proposal('reserve_open', 'res-1'),
    ])
    expect(out.map((c) => c.verificationMode)).toEqual(['field_check', 'field_check'])
    expect(out.every((c) => c.candidateKind === 'object')).toBe(true)
  })

  it('ask_confirm pour action_overdue, decision_unapplied, obligation_neglected', () => {
    const out = deriveVisitCandidates([
      proposal('action_overdue', 'act-1'),
      proposal('decision_unapplied', 'dec-1'),
      proposal('obligation_neglected', 'obl-1'),
    ])
    expect(out.map((c) => c.verificationMode)).toEqual(['ask_confirm', 'ask_confirm', 'ask_confirm'])
  })

  it('une proposition sans source_ref n’est pas un candidat (aucune identité)', () => {
    const out = deriveVisitCandidates([proposal('reserve_open', null)])
    expect(out).toHaveLength(0)
  })

  it('un source_kind hors politique est ignoré (aucun mode inventé)', () => {
    const out = deriveVisitCandidates([
      proposal('actor_congestion', 'x-1'), // présent dans SignalKind mais jamais dans la watchlist
      proposal('reserve_open', 'res-1'),
    ])
    expect(out.map((c) => c.sourceKind)).toEqual(['reserve_open'])
  })

  it('décisions et obligations HORS CANON sont produites même sans enrichissement (jamais perdues)', () => {
    const out = deriveVisitCandidates([
      proposal('decision_unapplied', 'dec-1'),
      proposal('obligation_neglected', 'obl-1'),
    ])
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.canonicalSubjectId === undefined)).toBe(true)
    expect(out.every((c) => c.reopenedBoost === false)).toBe(true)
  })
})

describe('enrichissement — LU, jamais reconstruit, ne change jamais le mode', () => {
  it('pose canonicalSubjectId / attentionCategory / displayState / cboState quand présents', () => {
    const enr = enrichmentMap([
      ['reserve_open', 'res-1', {
        canonicalSubjectId: 'cs-1', attentionCategory: 'act_now',
        displayState: 'open', cboState: 'progressing',
      }],
    ])
    const [c] = deriveVisitCandidates([proposal('reserve_open', 'res-1')], enr)
    expect(c.canonicalSubjectId).toBe('cs-1')
    expect(c.attentionCategory).toBe('act_now')
    expect(c.displayState).toBe('open')
    expect(c.cboState).toBe('progressing')
    expect(c.verificationMode).toBe('field_check')
  })

  it('sans rattachement : candidat nu, aucun champ fabriqué', () => {
    const [c] = deriveVisitCandidates([proposal('reserve_open', 'res-1')])
    expect(c.canonicalSubjectId).toBeUndefined()
    expect(c.attentionCategory).toBeUndefined()
    expect(c.displayState).toBeUndefined()
    expect(c.cboState).toBeUndefined()
    expect(c.reopenedBoost).toBe(false)
  })

  it('displayState=reopened ⇒ reopenedBoost mais le mode ask_confirm est INCHANGÉ', () => {
    const enr = enrichmentMap([
      ['decision_unapplied', 'dec-1', { canonicalSubjectId: 'cs-9', displayState: 'reopened' }],
    ])
    const [c] = deriveVisitCandidates([proposal('decision_unapplied', 'dec-1')], enr)
    expect(c.reopenedBoost).toBe(true)
    expect(c.verificationMode).toBe('ask_confirm') // reopened ne fabrique pas un constat
  })

  it('attentionCategory=act_now ne transforme jamais un ask_confirm en field_check', () => {
    const enr = enrichmentMap([
      ['action_overdue', 'act-1', { canonicalSubjectId: 'cs-2', attentionCategory: 'act_now' }],
    ])
    const [c] = deriveVisitCandidates([proposal('action_overdue', 'act-1')], enr)
    expect(c.attentionCategory).toBe('act_now')
    expect(c.verificationMode).toBe('ask_confirm')
  })

  it('le mode ne dépend QUE du source_kind, jamais de l’enrichissement', () => {
    const rich: SubjectEnrichment = {
      canonicalSubjectId: 'cs-x', attentionCategory: 'act_now',
      displayState: 'reopened', cboState: 'conflict',
    }
    const withEnr = deriveVisitCandidates([proposal('reserve_open', 'r')], enrichmentMap([['reserve_open', 'r', rich]]))
    const without = deriveVisitCandidates([proposal('reserve_open', 'r')])
    expect(withEnr[0].verificationMode).toBe(without[0].verificationMode)
    expect(withEnr[0].verificationMode).toBe('field_check')
  })
})

describe('WOW-2A′ — identité object-first préservée', () => {
  it('la clé d’identité d’un candidat est exactement watchlistSourceKey(source_kind, source_ref)', () => {
    const [c] = deriveVisitCandidates([proposal('decision_unapplied', 'dec-42')])
    expect(watchlistSourceKey(c.sourceKind, c.sourceRef)).toBe('decision_unapplied|dec-42')
  })
})

describe('rankVisitCandidates — enrichissement ranke, ne reclasse pas le mode', () => {
  it('reopened d’abord, puis field_check avant ask_confirm, puis act_now, puis priorité', () => {
    const enr = enrichmentMap([
      ['action_overdue', 'reopened-ask', { canonicalSubjectId: 'a', displayState: 'reopened' }],
      ['reserve_open', 'actnow-field', { canonicalSubjectId: 'b', attentionCategory: 'act_now' }],
      ['reserve_open', 'watch-field', { canonicalSubjectId: 'c', attentionCategory: 'watch' }],
    ])
    const ranked = rankVisitCandidates(deriveVisitCandidates([
      proposal('reserve_open', 'watch-field'),
      proposal('action_overdue', 'reopened-ask'), // ask_confirm mais reopened → remonte tout en haut
      proposal('decision_unapplied', 'plain-ask'),
      proposal('reserve_open', 'actnow-field'),
    ], enr))
    expect(ranked.map((c) => c.sourceRef)).toEqual([
      'reopened-ask',  // booster reopened, malgré ask_confirm
      'actnow-field',  // field_check + act_now
      'watch-field',   // field_check + watch
      'plain-ask',     // ask_confirm nu
    ])
  })

  it('catégorie absente = neutre (entre watch et dormant), ne fait pas remonter artificiellement', () => {
    const enr = enrichmentMap([
      ['reserve_open', 'watch', { canonicalSubjectId: 'w', attentionCategory: 'watch' }],
      ['reserve_open', 'dormant', { canonicalSubjectId: 'd', attentionCategory: 'dormant' }],
    ])
    const ranked = rankVisitCandidates(deriveVisitCandidates([
      proposal('reserve_open', 'dormant'),
      proposal('reserve_open', 'plain'), // pas d'enrichissement → neutre
      proposal('reserve_open', 'watch'),
    ], enr))
    expect(ranked.map((c) => c.sourceRef)).toEqual(['watch', 'plain', 'dormant'])
  })
})
