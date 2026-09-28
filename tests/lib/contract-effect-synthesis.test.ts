// DOC-CONTRACT-OS-1A-UX (mandat Vincent 2026-09-28) — remplace le bulk trompeur
// « Créer les N Engagements » par une synthèse de revue contractuelle pour
// OS/Avenant. Ce fichier teste les deux fonctions pures qui pilotent l'écran :
// computeContractEffectSynthesis (compteurs par effet) et
// isContractEffectReviewComplete (condition de « Terminer la revue »), sans
// migration ni nouveau statut DB — calculées à partir des propositions existantes.

import { describe, it, expect } from 'vitest'
import {
  computeContractEffectSynthesis,
  isContractEffectReviewComplete,
} from '@/lib/engagements/contract-effect'

type Proposal = { proposal_family: string; review_status: string; source_payload: unknown }

function proposal(
  effect: string | undefined,
  opts: Partial<Proposal> = {},
): Proposal {
  return {
    proposal_family: 'engagement',
    review_status: 'edited',
    source_payload: effect ? { contract_effect: { effect } } : {},
    ...opts,
  }
}

describe('computeContractEffectSynthesis', () => {
  it('proposition engagement sans contract_effect — à qualifier', () => {
    const synthesis = computeContractEffectSynthesis([proposal(undefined)])
    expect(synthesis.totalRelevant).toBe(1)
    expect(synthesis.toQualify).toBe(1)
  })

  it('effet NEW qualifié — bucket new', () => {
    const synthesis = computeContractEffectSynthesis([proposal('new')])
    expect(synthesis.new).toBe(1)
    expect(synthesis.toQualify).toBe(0)
  })

  it('effet CONFIRM qualifié — bucket confirm', () => {
    const synthesis = computeContractEffectSynthesis([proposal('confirm')])
    expect(synthesis.confirm).toBe(1)
  })

  it('effets MODIFY et SUSPEND — combinés dans pendingApplication', () => {
    const synthesis = computeContractEffectSynthesis([proposal('modify'), proposal('suspend')])
    expect(synthesis.pendingApplication).toBe(2)
  })

  it('effet CONFLICT — bucket conflict, compté comme qualifié', () => {
    const synthesis = computeContractEffectSynthesis([proposal('conflict')])
    expect(synthesis.conflict).toBe(1)
    expect(synthesis.toQualify).toBe(0)
  })

  it('effet NON_ENGAGEMENT — bucket nonEngagement, compté comme qualifié', () => {
    const synthesis = computeContractEffectSynthesis([proposal('non_engagement')])
    expect(synthesis.nonEngagement).toBe(1)
    expect(synthesis.toQualify).toBe(0)
  })

  it('proposition déjà matérialisée — bucket materialized, jamais recomptée ailleurs', () => {
    const synthesis = computeContractEffectSynthesis([
      proposal('new', { review_status: 'materialized' }),
    ])
    expect(synthesis.materialized).toBe(1)
    expect(synthesis.new).toBe(0)
    expect(synthesis.totalRelevant).toBe(1)
  })

  it('proposition rejetée — exclue de totalRelevant et de tous les buckets', () => {
    const synthesis = computeContractEffectSynthesis([
      proposal('new', { review_status: 'rejected' }),
    ])
    expect(synthesis.totalRelevant).toBe(0)
    expect(synthesis.new).toBe(0)
    expect(synthesis.toQualify).toBe(0)
  })

  it('proposition family non-engagement (visite, photo…) — ignorée entièrement', () => {
    const synthesis = computeContractEffectSynthesis([
      proposal(undefined, { proposal_family: 'visit_observation' }),
    ])
    expect(synthesis.totalRelevant).toBe(0)
    expect(synthesis.toQualify).toBe(0)
  })

  it('mélange complet — chaque proposition dans le bon bucket, total cohérent', () => {
    const synthesis = computeContractEffectSynthesis([
      proposal(undefined),
      proposal('new'),
      proposal('confirm'),
      proposal('modify'),
      proposal('suspend'),
      proposal('conflict'),
      proposal('non_engagement'),
      proposal('new', { review_status: 'materialized' }),
      proposal('new', { review_status: 'rejected' }),
      proposal(undefined, { proposal_family: 'visit_observation' }),
    ])
    expect(synthesis).toEqual({
      totalRelevant: 8,
      toQualify: 1,
      new: 1,
      confirm: 1,
      pendingApplication: 2,
      conflict: 1,
      nonEngagement: 1,
      materialized: 1,
    })
  })
})

describe('isContractEffectReviewComplete', () => {
  it('toutes les propositions qualifiées (aucune à qualifier) — revue terminable', () => {
    const synthesis = computeContractEffectSynthesis([proposal('new'), proposal('confirm')])
    expect(isContractEffectReviewComplete(synthesis)).toBe(true)
  })

  it('une proposition non qualifiée — revue non terminable', () => {
    const synthesis = computeContractEffectSynthesis([proposal('new'), proposal(undefined)])
    expect(isContractEffectReviewComplete(synthesis)).toBe(false)
  })

  it('CONFLICT qualifié seul — revue terminable malgré le conflit non résolu', () => {
    const synthesis = computeContractEffectSynthesis([proposal('conflict')])
    expect(isContractEffectReviewComplete(synthesis)).toBe(true)
  })

  it('NON_ENGAGEMENT seul — revue terminable sans matérialisation', () => {
    const synthesis = computeContractEffectSynthesis([proposal('non_engagement')])
    expect(isContractEffectReviewComplete(synthesis)).toBe(true)
  })

  it('aucune proposition engagement — revue terminable (rien à qualifier)', () => {
    const synthesis = computeContractEffectSynthesis([])
    expect(isContractEffectReviewComplete(synthesis)).toBe(true)
  })
})
