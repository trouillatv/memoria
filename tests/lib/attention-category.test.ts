// P2-2 — CONTRAT de la grammaire d'attention TRANSVERSE (act_now | watch | dormant |
// documentary_silence) et de sa séparation primitive générique / politique métier.
// Invariant de transversalité : aucune sémantique de domaine (BTP/HSE/nettoyage) dans le moteur ;
// le seuil de silence et l'ensemble act_now sont une POLITIQUE, pas une constante universelle.

import { describe, it, expect } from 'vitest'
import {
  classifyAttentionCategory,
  isDocumentarySilence,
  DEFAULT_ATTENTION_POLICY,
  ATTENTION_CATEGORY_RANK,
  type AttentionPolicy,
} from '@/lib/knowledge/canonical-attention'
import { pvSinceMentionCount } from '@/lib/db/canonical-subject-life'

describe('classifyAttentionCategory — précédence act_now > silence > dormant > watch', () => {
  const base = { signals: [] as never[], isStagnant: false, pvSinceLastMention: 0, activeObjectsCboAware: 0 }

  it('act_now prime sur tout : un signal act_now l\'emporte même si silence/stagnant', () => {
    expect(classifyAttentionCategory({
      ...base, signals: ['pv_aggrave'], isStagnant: true, pvSinceLastMention: 5, activeObjectsCboAware: 3,
    })).toBe('act_now')
    expect(classifyAttentionCategory({ ...base, signals: ['action_overdue'] })).toBe('act_now')
    expect(classifyAttentionCategory({ ...base, signals: ['pv_reopened'] })).toBe('act_now')
    expect(classifyAttentionCategory({ ...base, signals: ['pv_non_conforme'] })).toBe('act_now')
    expect(classifyAttentionCategory({ ...base, signals: ['stagnant_blocking'] })).toBe('act_now')
  })

  it('un rappel/bonus n\'est PAS act_now : action_to_verify, deadline_near, stagnant, open_with_objects', () => {
    expect(classifyAttentionCategory({ ...base, signals: ['action_to_verify'] })).toBe('watch')
    expect(classifyAttentionCategory({ ...base, signals: ['deadline_near'] })).toBe('watch')
    expect(classifyAttentionCategory({ ...base, signals: ['open_with_objects'] })).toBe('watch')
  })

  it('silence prime sur dormant : ≥2 PV sans mention + activité durable, même stagnant', () => {
    expect(classifyAttentionCategory({
      ...base, signals: ['stagnant'], isStagnant: true, pvSinceLastMention: 2, activeObjectsCboAware: 1,
    })).toBe('documentary_silence')
  })

  it('dormant : stagnant, encore présent (silence non atteint)', () => {
    expect(classifyAttentionCategory({
      ...base, signals: ['stagnant'], isStagnant: true, pvSinceLastMention: 1, activeObjectsCboAware: 1,
    })).toBe('dormant')
  })

  it('watch : actif/pertinent, ni act_now ni stagnant ni silence', () => {
    expect(classifyAttentionCategory({
      ...base, signals: ['open_with_objects'], activeObjectsCboAware: 1,
    })).toBe('watch')
  })

  it('absent depuis longtemps mais SANS activité durable → pas de silence (one-shot informatif)', () => {
    // Adresse / type ERP / formation : activité durable nulle → jamais silence.
    expect(classifyAttentionCategory({
      ...base, signals: [], isStagnant: false, pvSinceLastMention: 6, activeObjectsCboAware: 0,
    })).toBe('watch')
    expect(isDocumentarySilence(6, 0)).toBe(false)
  })
})

describe('isDocumentarySilence — le SEUIL est une politique, pas une vérité du moteur', () => {
  it('politique par défaut (RUS) : seuil = 2', () => {
    expect(DEFAULT_ATTENTION_POLICY.silenceCycles).toBe(2)
    expect(isDocumentarySilence(1, 1)).toBe(false)
    expect(isDocumentarySilence(2, 1)).toBe(true)
  })

  it('une politique métier différente change le seuil SANS toucher au moteur', () => {
    const hsePolicy: AttentionPolicy = { actNowSignals: new Set(), silenceCycles: 1 }
    // Sous cette politique, 1 cycle suffit.
    expect(isDocumentarySilence(1, 1, hsePolicy)).toBe(true)
    // classify respecte la politique fournie.
    expect(classifyAttentionCategory(
      { signals: [], isStagnant: false, pvSinceLastMention: 1, activeObjectsCboAware: 1 },
      hsePolicy,
    )).toBe('documentary_silence')
  })

  it('une politique peut retirer un signal de act_now (transversalité)', () => {
    // Politique où pv_non_conforme n\'est PLUS act_now (ex. finition BTP mineure).
    const soft: AttentionPolicy = { actNowSignals: new Set(['pv_reopened']), silenceCycles: 2 }
    expect(classifyAttentionCategory(
      { signals: ['pv_non_conforme'], isStagnant: false, pvSinceLastMention: 0, activeObjectsCboAware: 1 },
      soft,
    )).toBe('watch')
  })
})

describe('ATTENTION_CATEGORY_RANK — ordre d\'affichage', () => {
  it('act_now < watch < dormant < documentary_silence', () => {
    expect(ATTENTION_CATEGORY_RANK.act_now).toBeLessThan(ATTENTION_CATEGORY_RANK.watch)
    expect(ATTENTION_CATEGORY_RANK.watch).toBeLessThan(ATTENTION_CATEGORY_RANK.dormant)
    expect(ATTENTION_CATEGORY_RANK.dormant).toBeLessThan(ATTENTION_CATEGORY_RANK.documentary_silence)
  })
})

describe('pvSinceMentionCount — primitive documentaire générique (dates métier, jamais created_at)', () => {
  const timeline = ['2025-01-29', '2025-03-27', '2025-05-23', '2025-07-10', '2025-08-27', '2025-12-03', '2026-02-19', '2026-07-22']

  it('présent au dernier PV → 0', () => {
    expect(pvSinceMentionCount('2026-07-22', timeline)).toBe(0)
  })
  it('dernière mention à l\'avant-dernier PV → 1', () => {
    expect(pvSinceMentionCount('2026-02-19', timeline)).toBe(1)
  })
  it('dernière mention 2 PV avant la fin → 2 (silence si activité durable)', () => {
    expect(pvSinceMentionCount('2025-12-03', timeline)).toBe(2)
  })
  it('sujet jamais vu (lastSeenAt null) → 0 (on ne fabrique pas de silence)', () => {
    expect(pvSinceMentionCount(null, timeline)).toBe(0)
  })
  it('date entre deux points compte les points strictement postérieurs', () => {
    expect(pvSinceMentionCount('2025-12-10', timeline)).toBe(2) // 2026-02-19, 2026-07-22
  })
})
