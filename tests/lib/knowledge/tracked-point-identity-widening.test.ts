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

describe('Faux positifs PV6 Dumbéa Mall — Gate 1 (same_subject/orphan/related_subject) seul ne suffit plus (mandat post-PV6)', () => {
  // Forme réelle de production pour l'import historique PV6 : le thread candidat n'a PAS de
  // canonical_subject_id résolu au moment de la reconciliation (subject_thread_identity vide
  // pour ces 4 traces nommées) → CandidateThreadInput.subjectId = null → Gate 1 tranche 'orphan',
  // jamais 'same_subject'. Les 4 témoins ci-dessous reproduisent donc subjectId: null, pas un
  // sujet partagé fictif.
  it('haut-parleur accueil ≠ TGBT : un seul token partagé insuffisant, reste DISTINCT_POINT (rail orphan)', async () => {
    const tgbtPoint = point({
      pointId: '790e3490-d3a7-4ace-bc24-fcdd88cfc0d3',
      label: 'Supprimer tout stockage des locaux techniques (notamment local TGBT)',
      ownerSubjectId: 'subj-tgbt',
      ownerSubjectLabel: 'Stockage locaux techniques',
      memberLabels: [],
    })
    const hpAccueilThread = candidate({
      threadId: 'bbd0929b-524c-4dcf-b25d-e7758dba53c9',
      label: 'CAPSE vérifie suppression HP accueil',
      subjectId: null,
      subjectLabel: null,
    })
    const r = await evaluateWidenedMembershipCandidate(hpAccueilThread, tgbtPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })

  it('test haut-parleurs parking ≠ zone fumeur : un seul token partagé insuffisant, reste DISTINCT_POINT (rail orphan)', async () => {
    const zoneFumeurPoint = point({
      pointId: '70c16433-0840-47d7-959f-a6d86e9bf604',
      label: 'Identifier la zone fumeur sur le parking / parvis',
      ownerSubjectId: 'subj-parking',
      ownerSubjectLabel: 'Aménagement parking',
      memberLabels: [],
    })
    const hpParkingThread = candidate({
      threadId: 'eacd0e1a-c82c-40af-b0be-b615164a748b',
      label: "Tester HP evacuation parking",
      subjectId: null,
      subjectLabel: null,
    })
    const r = await evaluateWidenedMembershipCandidate(hpParkingThread, zoneFumeurPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })

  it('DAI couloir frais ≠ porte CF R+1 : un seul token partagé ("couloir") insuffisant, reste DISTINCT_POINT (rail orphan)', async () => {
    const porteCfPoint = point({
      pointId: '3482a8e3-7e19-42c2-8833-3a189e7a87f4',
      label: "Vérifier l'intégrité de la porte CF du couloir de circulation R+1 (penne supprimée)",
      ownerSubjectId: 'subj-ssi',
      ownerSubjectLabel: 'Fonctionnalités et utilisation du SSI (Sécurité Incendie)',
      memberLabels: [],
    })
    const daiCouloirThread = candidate({
      threadId: '08573d31-0d2f-4a11-9663-0ebfa61e738a',
      label: 'Ares propose une solution technique pour la DAI du couloir frais',
      subjectId: null,
      subjectLabel: null,
    })
    const r = await evaluateWidenedMembershipCandidate(daiCouloirThread, porteCfPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })

  it('dossier identité SSI ne doit plus candidater sur "Réunion SSI avec ARES" (rail orphan, sujet large non discriminant)', async () => {
    const reunionSsiPoint = point({
      pointId: 'ab88019c-58e7-4831-ac05-dc1863491698',
      label: "Réunion SSI avec ARES pour faire un point sur l'ensemble des sujets restants",
      ownerSubjectId: 'subj-ssi',
      ownerSubjectLabel: 'Fonctionnalités et utilisation du SSI (Sécurité Incendie)',
      memberLabels: [],
    })
    const dossierIdentiteThread = candidate({
      threadId: 'df3a4f9a-a554-4b62-9517-b96629396f4a',
      label: 'Mettre à jour dossier identité SSI',
      subjectId: null,
      subjectLabel: null,
    })
    const r = await evaluateWidenedMembershipCandidate(dossierIdentiteThread, reunionSsiPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })

  it('rappel : le rail same_subject seul (sujet partagé explicite) reste aussi insuffisant sans chevauchement discriminant', async () => {
    const tgbtPoint = point({
      pointId: '790e3490-d3a7-4ace-bc24-fcdd88cfc0d3',
      label: 'Supprimer tout stockage des locaux techniques (notamment local TGBT)',
      ownerSubjectId: 'subj-tgbt',
      ownerSubjectLabel: 'Stockage locaux techniques',
      memberLabels: [],
    })
    const hpAccueilThread = candidate({
      threadId: 'bbd0929b-524c-4dcf-b25d-e7758dba53c9',
      label: 'CAPSE vérifie suppression HP accueil',
      subjectId: 'subj-tgbt',
      subjectLabel: 'Stockage locaux techniques',
    })
    const r = await evaluateWidenedMembershipCandidate(hpAccueilThread, tgbtPoint)
    expect(r.decision).toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBeNull()
  })

  it('recall préservé : deux traces orphan partageant un identifiant discriminant (r7) entrent bien dans le pool', async () => {
    const r7Point = point({
      pointId: 'point-r7-orphan',
      label: 'Surveillance des fissures du Regard R7 jusqu\'au prochain CR',
      ownerSubjectId: 'subj-r7',
      ownerSubjectLabel: 'Assainissement Regard R7',
      memberLabels: [],
    })
    const r7OrphanThread = candidate({
      threadId: 'thread-r7-orphan',
      label: "Point sur l'état du Regard R7 lors de la visite",
      subjectId: null,
      subjectLabel: null,
    })
    const r = await evaluateWidenedMembershipCandidate(r7OrphanThread, r7Point)
    expect(r.decision).not.toBe('DISTINCT_POINT')
    expect(r.neighborhoodRule).toBe('orphan')
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
