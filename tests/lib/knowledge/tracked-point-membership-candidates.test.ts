// Test UNITAIRE — Phase 4 (programme Point de suivi). Moteur de membership READ-ONLY,
// pur (aucune DB, aucun LLM câblé). Rejoue les 6 étalons imposés par Vincent (clôture
// Phase 3) : F8 (cross-famille, sans LLM), RIA positif/négatif, CTA, Extincteurs, Sprinkler.
// Sources : P0-1G-CONTRAT-POINT-DE-SUIVI.md lignes 68-75 (recettes) et 151-188 (arbre réel).

import { describe, it, expect } from 'vitest'
import {
  evaluateMembershipCandidate,
  resolveNeighborhoodRule,
  type CandidateThreadInput,
  type TrackedPointCandidate,
} from '@/lib/knowledge/tracked-point-membership-candidates'

const candidate = (over: Partial<CandidateThreadInput> = {}): CandidateThreadInput => ({
  threadId: 'thread1',
  label: 'label',
  subjectId: 'subject-a',
  subjectLabel: 'Sujet A',
  cboId: null,
  runId: null,
  ...over,
})

const point = (over: Partial<TrackedPointCandidate> = {}): TrackedPointCandidate => ({
  pointId: 'point1',
  label: 'label',
  ownerSubjectId: 'subject-a',
  ownerSubjectLabel: 'Sujet A',
  memberLabels: [],
  memberCboIds: [],
  memberRunIds: [],
  ...over,
})

describe('resolveNeighborhoodRule — Gate 1', () => {
  it('même subjectId → same_subject', () => {
    expect(resolveNeighborhoodRule(candidate({ subjectId: 'x' }), point({ ownerSubjectId: 'x' }))).toBe('same_subject')
  })

  it('subjectId null → orphan', () => {
    expect(resolveNeighborhoodRule(candidate({ subjectId: null, subjectLabel: null }), point())).toBe('orphan')
  })

  it('sujets distincts et non apparentés → null (hors voisinage)', () => {
    expect(
      resolveNeighborhoodRule(
        candidate({ subjectId: 'y', subjectLabel: 'Formation cadres sprinkler' }),
        point({ ownerSubjectId: 'x', ownerSubjectLabel: 'Hauteur de stockage palettes' }),
      ),
    ).toBeNull()
  })
})

describe('rail cbo — CBO membre partagé', () => {
  it('même cboId que le Point → SAME_POINT, rail cbo, quel que soit le sujet', () => {
    const r = evaluateMembershipCandidate(
      candidate({ cboId: 'cbo-9fbc1eae', subjectId: 'other', subjectLabel: 'Autre sujet' }),
      point({ memberCboIds: ['cbo-9fbc1eae'], ownerSubjectId: 'subject-a', ownerSubjectLabel: 'Compartimentage' }),
    )
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).toBe('cbo')
  })
})

describe('rail exact — label identique après normalisation', () => {
  it('même label (casse/espaces différents) → SAME_POINT, rail exact', () => {
    const r = evaluateMembershipCandidate(
      candidate({ label: '  RIA bureaux R+1  ', subjectId: 'subject-a' }),
      point({ label: 'RIA bureaux R+1', ownerSubjectId: 'subject-a' }),
    )
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).toBe('exact')
  })
})

describe('Étalon F8 — compartimentage CF 1h baie de brassage (cross-famille, SANS LLM)', () => {
  const f8Point = point({
    pointId: 'point-f8',
    label: 'Compartimentage CF 1h autour de la baie de brassage en réserve 3',
    ownerSubjectId: 'd210ff95',
    ownerSubjectLabel: 'Compartimentage',
    memberLabels: ['Choix de créer un compartimentage CF 1h autour de la baie de brassage en réserve 3'],
    memberCboIds: ['9fbc1eae'],
  })

  it('kf "réalisé en juillet 2026", sujet apparenté (mismatch historique) → SAME_POINT sans LLM', () => {
    const kf = candidate({
      threadId: '021f7314',
      label: 'Compartimentage CF 1h autour de la baie de brassage en réserve 3 réalisé en Juillet 2026',
      subjectId: 'e141b815',
      subjectLabel: 'Baie de brassage / Compartimentage réserve',
    })
    const r = evaluateMembershipCandidate(kf, f8Point)
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).not.toBe('llm')
    expect(r.evidence.subjectMismatch).toBe(true)
    expect(r.evidence.boundedCandidates).toBeNull()
  })

  it('thread orphelin (aucune subject_thread_identity) au même libellé → SAME_POINT sans LLM', () => {
    const kf = candidate({
      threadId: 'orphan-kf',
      label: 'Compartimentage CF 1h autour de la baie de brassage en réserve 3 réalisé en Juillet 2026',
      subjectId: null,
      subjectLabel: null,
    })
    const r = evaluateMembershipCandidate(kf, f8Point)
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).not.toBe('llm')
    expect(r.evidence.subjectRelation).toBe('orphan')
  })
})

describe('Étalon RIA positif — Point "RIA bureaux R+1"', () => {
  const riaPoint = point({
    pointId: 'point-ria-bureaux',
    label: 'RIA bureaux R+1',
    ownerSubjectId: 'subj-ria-bureaux',
    ownerSubjectLabel: 'RIA bureaux R+1',
    memberLabels: ['RIA manquant dans la circulation horizontale des bureaux R+1'],
  })

  it('observation "RIA manquant circulation horizontale bureaux R+1" → SAME_POINT sans LLM', () => {
    const obs = candidate({
      threadId: '752965ad',
      label: 'RIA manquant dans la circulation horizontale des bureaux R+1',
      subjectId: 'subj-ria-bureaux',
      subjectLabel: 'RIA bureaux R+1',
    })
    const r = evaluateMembershipCandidate(obs, riaPoint)
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).not.toBe('llm')
  })

  it('decision "Décision à prendre pour RIA des bureaux R+1" → SAME_POINT sans LLM (via label curaté du Point)', () => {
    const decision = candidate({
      threadId: 'db5087a0',
      label: 'Décision à prendre pour RIA des bureaux R+1',
      subjectId: 'subj-ria-bureaux',
      subjectLabel: 'RIA bureaux R+1',
    })
    const r = evaluateMembershipCandidate(decision, riaPoint)
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).not.toBe('llm')
  })
})

describe('Étalon RIA négatif — réserves ≠ bureaux R+1 (anti-fusion)', () => {
  it('kf "RIA dans les 3 réserves" vs Point "RIA bureaux R+1" → DISTINCT_POINT', () => {
    const riaPoint = point({
      pointId: 'point-ria-bureaux',
      label: 'RIA bureaux R+1',
      ownerSubjectId: 'subj-ria-bureaux',
      ownerSubjectLabel: 'RIA bureaux R+1',
      memberLabels: ['RIA manquant dans la circulation horizontale des bureaux R+1', 'Décision à prendre pour RIA des bureaux R+1'],
    })
    const reservesKf = candidate({
      threadId: 'kf-ria-reserves',
      label: 'Vérification RIA dans les 3 réserves : présence de 2 ou 3 RIA',
      subjectId: 'subj-ria-reserves',
      subjectLabel: 'RIA réserves',
    })
    const r = evaluateMembershipCandidate(reservesKf, riaPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
  })
})

describe('Étalon CTA négatif — raccordement SSI ≠ programmation arrêt', () => {
  it('kf "Raccordement de la CTA au SSI" vs Point "Vérifier la programmation d\'arrêt des CTA" → DISTINCT_POINT', () => {
    const ctaPoint = point({
      pointId: 'point-cta-programmation',
      label: "Vérifier la programmation d'arrêt des CTA",
      ownerSubjectId: 'subj-cta-programmation',
      ownerSubjectLabel: "Programmation d'arrêt des CTA",
      memberLabels: [],
    })
    const raccordementKf = candidate({
      threadId: 'kf-cta-raccordement',
      label: 'Raccordement de la CTA au SSI',
      subjectId: 'subj-cta-raccordement',
      subjectLabel: 'Raccordement CTA SSI',
    })
    const r = evaluateMembershipCandidate(raccordementKf, ctaPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
  })
})

describe('Étalon Extincteurs négatif — réalisés ≠ plan à mettre à jour', () => {
  it('kf "Mise à jour des extincteurs réalisée" vs Point "Plan des extincteurs à mettre à jour" → DISTINCT_POINT', () => {
    const planPoint = point({
      pointId: 'point-extincteurs-plan',
      label: 'Plan des extincteurs à mettre à jour',
      ownerSubjectId: 'subj-extincteurs-plan',
      ownerSubjectLabel: 'Plan des extincteurs',
      memberLabels: [],
    })
    const realiseeKf = candidate({
      threadId: 'kf-extincteurs-realisee',
      label: 'Mise à jour des extincteurs réalisée',
      subjectId: 'subj-extincteurs-realisee',
      subjectLabel: 'Mise à jour des extincteurs',
    })
    const r = evaluateMembershipCandidate(realiseeKf, planPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
  })
})

describe('Étalon Sprinkler — 6 thèmes distincts (anti-sur-fusion)', () => {
  const themes = [
    'Formation cadres sprinkler',
    'Modification du réseau sprinkler',
    'Hauteur de stockage des palettes',
    'Cuves d\'eau sprinkler',
    'Dérive de pression au poste 6',
    'Têtes sprinkler 300°C rôtisserie',
  ]

  it('chaque paire de thèmes distincts reste DISTINCT_POINT', () => {
    for (let i = 0; i < themes.length; i++) {
      for (let j = 0; j < themes.length; j++) {
        if (i === j) continue
        const p = point({
          pointId: `point-sprinkler-${i}`,
          label: themes[i],
          ownerSubjectId: `subj-sprinkler-${i}`,
          ownerSubjectLabel: themes[i],
          memberLabels: [],
        })
        const c = candidate({
          threadId: `thread-sprinkler-${j}`,
          label: themes[j],
          subjectId: `subj-sprinkler-${j}`,
          subjectLabel: themes[j],
        })
        const r = evaluateMembershipCandidate(c, p)
        expect(r.decision).toBe('DISTINCT_POINT')
      }
    }
  })
})

describe('Traçabilité — explicabilité obligatoire (pas de simple booléen)', () => {
  it('chaque résultat porte rail, candidat, verdict, raison, subject_mismatch, boundedCandidates', () => {
    const r = evaluateMembershipCandidate(candidate(), point())
    expect(r.candidateThread).toBeTruthy()
    expect(r.candidatePoint).toBeTruthy()
    expect(r.decision).toBeTruthy()
    expect(r.rail).toBeTruthy()
    expect(typeof r.evidence.reasoning).toBe('string')
    expect(r.evidence.reasoning.length).toBeGreaterThan(0)
    expect(typeof r.evidence.subjectMismatch).toBe('boolean')
    expect('boundedCandidates' in r.evidence).toBe(true)
  })

  it('rail llm expose les candidats bornés présentés au juge', () => {
    const p = point({ label: 'X', ownerSubjectId: 'sa', ownerSubjectLabel: 'Sujet A', memberLabels: ['Y'] })
    const c = candidate({ label: 'Z totalement différent', subjectId: 'sa', subjectLabel: 'Sujet A' })
    const r = evaluateMembershipCandidate(c, p, {
      llmJudge: (_c, _p, pool) => ({ decision: 'UNCERTAIN', reasoning: `borné sur ${pool.length} candidats` }),
    })
    expect(r.rail).toBe('llm')
    expect(r.decision).toBe('UNCERTAIN')
    expect(r.evidence.boundedCandidates).toEqual(['X', 'Y'])
  })
})

describe('Zéro écriture Point — pureté de la fonction', () => {
  it('évaluations répétées identiques → même résultat (déterministe, aucun effet de bord)', () => {
    const p = point()
    const c = candidate()
    const a = evaluateMembershipCandidate(c, p)
    const b = evaluateMembershipCandidate(c, p)
    expect(a).toEqual(b)
  })
})
