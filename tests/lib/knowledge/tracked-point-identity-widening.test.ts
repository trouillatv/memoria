// Test UNITAIRE — P6, rail V2 d'identité Point (mandat « raccordement du rail V2 »).
// Rejoue les témoins imposés : R7 (CR011→CR012, doit ENTRER dans le voisinage candidat),
// zone après la dalle (ne doit plus tomber directement en DISTINCT sur simple différence
// lexicale), CTA (ancrage commun trop générique ne doit PAS provoquer de fusion abusive),
// et le chemin UNCERTAIN → NeedsYou (pas de fusion silencieuse quand le juge décline).
// Données réelles portées depuis le pilote OCEF (points R7/zone-après-dalle, PV CR011/CR012).

import { describe, it, expect } from 'vitest'
import {
  evaluateWidenedMembershipCandidate,
  resolveIdentityNeighborhood,
} from '@/lib/knowledge/tracked-point-identity-widening'
import { deriveConditionSignature } from '@/lib/knowledge/tracked-point-condition-signature'
import type { CandidateThreadInput, TrackedPointCandidate } from '@/lib/knowledge/tracked-point-membership-candidates'

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

describe('Témoin R7 — CR011 → CR012 (Regard R7, sujets distincts)', () => {
  const r7Point = point({
    pointId: 'a3713857-3fbd-4ca7-88f5-7dada975ddf0',
    label: 'Surveillance des fissures du Regard R7 jusqu\'au prochain CR, sans réparation immédiate',
    ownerSubjectId: '79e0509e',
    ownerSubjectLabel: 'Assainissement sous plateforme (busages, regards, visite mairie)',
    memberLabels: ['Fissures Regard R7 mesurées < 0,2 mm et limitées à la peau du béton'],
  })
  const cr012Candidate = candidate({
    threadId: '7218166a-ed65-4db8-b319-61e918702480',
    label: "OMNIS confirme l'absence de réparation nécessaire pour le Regard R7",
    subjectId: 'b1524a67',
    subjectLabel: 'Surveillance des fissures du Regard R7',
  })

  it('entre dans le voisinage élargi (ancre "r7" partagée, identifiant toujours significatif)', () => {
    const candidateSig = deriveConditionSignature(cr012Candidate.label)
    const pointSig = deriveConditionSignature(r7Point.label)
    expect(resolveIdentityNeighborhood(cr012Candidate, r7Point, candidateSig, pointSig)).toBe('signature_anchor_match')
  })

  it('sans juge → UNCERTAIN (pas de fusion par défaut), jamais DISTINCT direct', async () => {
    const r = await evaluateWidenedMembershipCandidate(cr012Candidate, r7Point)
    expect(r.decision).toBe('UNCERTAIN')
    expect(r.rail).toBe('signature')
  })

  it('juge SAME_POINT explicite → SAME_POINT, rail llm_identity', async () => {
    const r = await evaluateWidenedMembershipCandidate(cr012Candidate, r7Point, {
      identityJudge: async () => ({ decision: 'SAME_POINT', reasoning: 'même condition, même preuve de clôture' }),
    })
    expect(r.decision).toBe('SAME_POINT')
    expect(r.rail).toBe('llm_identity')
  })
})

describe('Témoin zone après la dalle — CR011 → CR012 (même sujet, libellés très différents)', () => {
  const dallePoint = point({
    pointId: '3e69ce84-e8ec-455d-9ee1-e5cb63adfbef',
    label: 'Mise en demeure maintenue jusqu\'à contre-essais conformes pour la zone après la dalle',
    ownerSubjectId: 'dc567108',
    ownerSubjectLabel: 'Non-conformité zone après la dalle',
    memberLabels: ['Essais PANDA non conformes'],
  })
  const moeCandidate = candidate({
    threadId: '8a1e0e23-eb7e-45b6-9fcf-c2a7ddba6906',
    label: 'Le MOE lève la réserve technique sur la zone après la dalle',
    subjectId: 'dc567108',
    subjectLabel: 'Non-conformité zone après la dalle',
  })

  it('ne tombe plus directement en DISTINCT sur simple différence lexicale (reste AMBIGUOUS → UNCERTAIN sans juge)', async () => {
    const r = await evaluateWidenedMembershipCandidate(moeCandidate, dallePoint)
    expect(r.decision).not.toBe('DISTINCT_POINT')
    expect(r.decision).toBe('UNCERTAIN')
  })
})

describe('Étalon CTA négatif — garde anti-overmerge sous le rail élargi', () => {
  it('ancrage commun trop générique ("cta" seul) ne provoque pas de fusion abusive : reste DISTINCT_POINT', async () => {
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
    const r = await evaluateWidenedMembershipCandidate(raccordementKf, ctaPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })
})

describe('Chemin UNCERTAIN → NeedsYou — jamais de fusion silencieuse', () => {
  it('juge qui décline (retourne null) → UNCERTAIN, pas un défaut SAME/DISTINCT', async () => {
    const p = point({ label: 'Surveillance des fissures du Regard R7', ownerSubjectId: 's1', memberLabels: [] })
    const c = candidate({ label: 'Le Regard R7 fait l\'objet d\'un suivi renforcé', subjectId: 's2' })
    const r = await evaluateWidenedMembershipCandidate(c, p, { identityJudge: async () => null })
    expect(r.decision).toBe('UNCERTAIN')
    expect(r.rail).toBe('signature')
  })
})
