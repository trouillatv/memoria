// @vitest-environment node
/**
 * P6-B — orchestration multi-intent (mandat Vincent, 2026-08-19).
 *
 * 10 tests obligatoires + 6 complémentaires, listés verbatim par Vincent
 * avant tout commit. Chaque test appelle la VRAIE `prepareCopilotAnswer` —
 * seuls les accès DB/LLM sont substitués — sauf les deux tests d'admissibilité
 * qui exercent `isP6MultiSegmentAdmissible` directement (fonction pure).
 *
 * Règle d'or vérifiée partout : tout-ou-rien. Le moindre segment non
 * admissible ou non résolu en `proposal` fait retomber sur le pipeline mono
 * INCHANGÉ — jamais de proposition partielle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isP6MultiSegmentAdmissible } from '@/lib/visits/copilot-decompose'
import type { IntentResult } from '@/lib/visits/copilot-intent-router'
import type { SubjectResolutionResult } from '@/lib/db/canonical-subject-resolve'

let iidCounter = 0
const logCopilotInteraction = vi.fn(async (..._args: unknown[]) => `iid-${++iidCounter}`)
const requireSiteAccess = vi.fn()
const resolveCanonicalSubjectReference = vi.fn(
  async (_siteId: string, _label: string): Promise<SubjectResolutionResult> => ({ kind: 'not_found' }),
)
const decomposeUtterance = vi.fn()

vi.mock('@/lib/auth/resource-access', () => ({
  requireSiteAccess: (...args: unknown[]) => requireSiteAccess(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('aucun segment de ce test ne doit toucher le client admin')
  },
}))

vi.mock('@/lib/knowledge/site-overview', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/knowledge/site-overview')>()
  return { ...orig, getSiteOverview: async (siteId: string) => orig.emptySiteOverview(siteId) }
})

vi.mock('@/lib/knowledge/visit-briefing', () => ({
  buildVisitBriefing: async () => null,
}))

vi.mock('@/lib/db/visit-preparation', () => ({
  listActivePreparationItems: async () => [],
}))

vi.mock('@/lib/visits/copilot-comprehension', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/visits/copilot-comprehension')>()
  return { ...orig, understandQuestion: async () => null }
})

vi.mock('@/lib/db/canonical-subject-resolve', () => ({
  resolveCanonicalSubjectReference: (...args: unknown[]) => resolveCanonicalSubjectReference(...args as [string, string]),
}))

vi.mock('@/lib/db/canonical-subject-life', () => ({
  getCanonicalSubjectLifeForSite: async () => null,
  getCanonicalSubjectLabelsByIds: () => {
    throw new Error("selectedCandidateId non utilisé par ces tests — getCanonicalSubjectLabelsByIds ne doit jamais être appelée")
  },
}))

vi.mock('@/lib/db/site-actor-responsibilities', () => ({
  getSiteActorContext: async () => [],
}))

vi.mock('@/lib/db/copilot-telemetry', () => ({
  logCopilotInteraction: (...args: unknown[]) => logCopilotInteraction(...args),
}))

// `decomposeUtterance` seul est substitué — `routeSegments`/`isP6MultiSegmentAdmissible`
// restent réels : le routage déterministe par segment (`detectIntent`) n'est jamais simulé.
vi.mock('@/lib/visits/copilot-decompose', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/visits/copilot-decompose')>()
  return { ...orig, decomposeUtterance: (...args: unknown[]) => decomposeUtterance(...args as [string]) }
})

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

function accessContext() {
  return { resourceId: SITE_ID, organizationId: 'org-1', membershipRole: 'manager' as const, userId: 'u1' }
}

/** Construit un `CopilotSegment` { start, end, dependsOn } par recherche du sous-texte. */
function seg(text: string, sub: string, dependsOn: number | null = null) {
  const start = text.indexOf(sub)
  if (start === -1) throw new Error(`"${sub}" introuvable dans "${text}"`)
  return { start, end: start + sub.length, dependsOn }
}

// Segments vérifiés (routage déterministe réel confirmé) :
const OBS_CADENAS = 'Le "cadenas" n\'est toujours pas posé.'
const CREATE_ACTION_PRESTA = 'Crée une action pour le prestataire.'
const WATCH_SSI = 'Surveille le SSI.'
const FACT_CODE = 'Le code du portail est 4812.'
const UNKNOWN_SIGNALEMENT = 'Fais un signalement pour le portail.'
const NEGATED_SSI = 'Ne surveille pas le SSI.'

const RESOLVED_CADENAS = { kind: 'resolved' as const, candidate: { id: 'cs-cadenas', label: 'Cadenas portail' } }

describe('P6-B — orchestration multi-intent (prepareCopilotAnswer réel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    iidCounter = 0
    requireSiteAccess.mockResolvedValue(accessContext())
    resolveCanonicalSubjectReference.mockImplementation(async () => ({ kind: 'not_found' as const }))
  })

  // ── 1. OBSERVATION ambiguous + CREATE_ACTION strong → 2 propositions ────────
  it('1. OBSERVATION ambiguous + CREATE_ACTION strong → 2 propositions', async () => {
    resolveCanonicalSubjectReference.mockImplementation(async (_siteId: string, label: string) =>
      label === 'cadenas' ? RESOLVED_CADENAS : { kind: 'not_found' as const })
    const question = `${OBS_CADENAS} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, OBS_CADENAS), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(decomposeUtterance).toHaveBeenCalledTimes(1)
    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposals')
    if (prep.result.kind !== 'proposals') throw new Error('unreachable')
    expect(prep.result.proposals).toHaveLength(2)
    expect(prep.result.proposals[0].proposal.kind).toBe('observation')
    expect(prep.result.proposals[1].proposal.kind).toBe('action')

    // Diagnostic cohérent sur succès multi (complémentaire 6, versant succès).
    expect(prep._diag.p6Attempted).toBe(true)
    expect(prep._diag.p6Decision).toBe('multi')
    expect(prep._diag.p6FallbackReason).toBeNull()
    expect(prep._diag.p6ProposalCount).toBe(2)
    expect(prep._diag.p6Segments).toHaveLength(2)
    expect(prep._diag.p6Segments[0].admissible).toBe(true)
    expect(prep._diag.p6Segments[0].rejectionReason).toBeNull()
    expect(prep._diag.p6Segments[0].resultKind).toBe('proposal')
    expect(prep._diag.p6Segments[0].proposalKind).toBe('observation')
    expect(prep._diag.p6Segments[1].proposalKind).toBe('action')
  })

  // ── 2. OBSERVATION + CREATE_ACTION + CREATE_WATCHPOINT → 3 propositions ─────
  it('2. OBSERVATION ambiguous + CREATE_ACTION strong + CREATE_WATCHPOINT strong → 3 propositions', async () => {
    resolveCanonicalSubjectReference.mockImplementation(async (_siteId: string, label: string) =>
      label === 'cadenas' ? RESOLVED_CADENAS : { kind: 'not_found' as const })
    const question = `${OBS_CADENAS} ${CREATE_ACTION_PRESTA} ${WATCH_SSI}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, OBS_CADENAS), seg(question, CREATE_ACTION_PRESTA), seg(question, WATCH_SSI)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposals')
    if (prep.result.kind !== 'proposals') throw new Error('unreachable')
    expect(prep.result.proposals).toHaveLength(3)
    expect(prep.result.proposals.map((p) => p.proposal.kind)).toEqual(['observation', 'action', 'watchpoint'])
    expect(prep._diag.p6ProposalCount).toBe(3)
  })

  // ── 3. FACT ambiguous + CREATE_ACTION strong → 2 propositions ───────────────
  it('3. FACT ambiguous + CREATE_ACTION strong → 2 propositions', async () => {
    const question = `${FACT_CODE} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, FACT_CODE), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposals')
    if (prep.result.kind !== 'proposals') throw new Error('unreachable')
    expect(prep.result.proposals).toHaveLength(2)
    expect(prep.result.proposals[0].proposal.kind).toBe('fact')
    expect(prep.result.proposals[1].proposal.kind).toBe('action')
    // FACT n'exige aucune résolution de sujet — jamais bloquant (contrairement à OBSERVATION).
    expect(resolveCanonicalSubjectReference).not.toHaveBeenCalled()
  })

  // ── 4. UNKNOWN_WRITE ambiguous + CREATE_ACTION strong → fallback mono ───────
  it('4. UNKNOWN_WRITE ambiguous + CREATE_ACTION strong → fallback mono, aucune proposition partielle', async () => {
    const question = `${UNKNOWN_SIGNALEMENT} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, UNKNOWN_SIGNALEMENT), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposals')
    expect(prep._diag.p6Attempted).toBe(true)
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('segment_not_admissible')
    expect(prep._diag.p6ProposalCount).toBe(0)
    expect(prep._diag.p6Segments[0].admissible).toBe(false)
    expect(prep._diag.p6Segments[0].rejectionReason).toBe('not_admissible')
  })

  // ── 5. Segment non admissible (negated_write_verb) → fallback mono ──────────
  it('5. un segment non admissible avec negated_write_verb → fallback mono', async () => {
    const question = `${NEGATED_SSI} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, NEGATED_SSI), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposals')

    // Diagnostic cohérent sur repli (complémentaire 6, versant fallback).
    expect(prep._diag.p6Attempted).toBe(true)
    expect(prep._diag.p6Ambiguous).toBe(false)
    expect(prep._diag.p6SegmentsCount).toBe(2)
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('segment_not_admissible')
    expect(prep._diag.p6ProposalCount).toBe(0)
    // Négation totale du verbe de vigilance → repli sûr en READ (Priorité 6 du
    // routeur, cf. copilot-intent-router.ts) : jamais CREATE_WATCHPOINT. READ
    // est de toute façon dans P6_NEVER_ADMISSIBLE_INTENTS, mais le signal
    // negated_write_verb reste porté pour traçabilité (garde-fou universel).
    expect(prep._diag.p6Segments[0].intent).toBe('READ')
    expect(prep._diag.p6Segments[0].signals).toContain('negated_write_verb')
    expect(prep._diag.p6Segments[0].admissible).toBe(false)
    expect(prep._diag.p6Segments[0].rejectionReason).toBe('not_admissible')
    // Le second segment n'a jamais été résolu : le repli est immédiat, au premier échec.
    expect(prep._diag.p6Segments[1].resultKind).toBeNull()
    expect(prep._diag.p6Segments[1].interactionId).toBeNull()
  })

  // ── 6. Décomposition globale ambiguous:true → mono inchangé ─────────────────
  it('6. décomposition globale ambiguous:true → comportement mono inchangé', async () => {
    const question = CREATE_ACTION_PRESTA
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: true,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposal')
    if (prep.result.kind !== 'proposal') throw new Error('unreachable')
    expect(prep.result.proposal.kind).toBe('action')
    expect(prep._diag.p6Attempted).toBe(true)
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('ambiguous_decomposition')
    expect(prep._diag.p6ProposalCount).toBe(0)
  })

  // ── 7. Un seul segment → mono inchangé ───────────────────────────────────────
  it('7. un seul segment → comportement mono inchangé', async () => {
    const question = CREATE_ACTION_PRESTA
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposal')
    if (prep.result.kind !== 'proposal') throw new Error('unreachable')
    expect(prep.result.proposal.kind).toBe('action')
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('single_segment')
  })

  // ── 10 (volet préparation). Aucun nouveau writer, interactionId propre ──────
  it('10. aucun nouveau writer / chaque proposition garde son propre interactionId et son pipeline existant', async () => {
    resolveCanonicalSubjectReference.mockImplementation(async (_siteId: string, label: string) =>
      label === 'cadenas' ? RESOLVED_CADENAS : { kind: 'not_found' as const })
    const question = `${OBS_CADENAS} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, OBS_CADENAS), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).toBe('proposals')
    if (prep.result.kind !== 'proposals') throw new Error('unreachable')

    // Même primitive de télémétrie que le mono (`logCopilotInteraction`), appelée
    // une fois par segment — aucun nouveau chemin d'écriture introduit par P6-B.
    expect(logCopilotInteraction).toHaveBeenCalledTimes(2)
    const [p1, p2] = prep.result.proposals
    expect(p1.interactionId).not.toBeNull()
    expect(p2.interactionId).not.toBeNull()
    expect(p1.interactionId).not.toBe(p2.interactionId)
    // Les builders réels (`buildObservationProposal`/`buildCopilotProposal`) sont
    // ceux du pipeline mono — mêmes `proposalId` uniques, aucune fabrique parallèle.
    expect(p1.proposal.proposalId).not.toBe(p2.proposal.proposalId)
    expect(p1.segmentIndex).toBe(0)
    expect(p2.segmentIndex).toBe(1)
    expect(p1.segmentText).toBe(OBS_CADENAS)
    expect(p2.segmentText).toBe(CREATE_ACTION_PRESTA)
  })

  // ── Complémentaire — CORRECTION_IDENTITY strong + negated_write_verb ────────
  it('complémentaire : CORRECTION_IDENTITY strong + negated_write_verb → non admissible', () => {
    const intent: IntentResult = { intent: 'CORRECTION_IDENTITY', confidence: 'strong', signals: ['negated_write_verb'] }
    expect(isP6MultiSegmentAdmissible(intent)).toBe(false)
  })

  // ── Complémentaire — RELATION_CLAIM strong + negated_write_verb ─────────────
  it('complémentaire : RELATION_CLAIM strong + negated_write_verb → non admissible', () => {
    const intent: IntentResult = { intent: 'RELATION_CLAIM', confidence: 'strong', signals: ['negated_write_verb'] }
    expect(isP6MultiSegmentAdmissible(intent)).toBe(false)
  })

  // ── Correctif B (Vincent 2026-08-19) — hasWriteBlockingSemanticSignal généralise
  // le gate P6-B au-delà du seul littéral 'negated_write_verb' ────────────────
  it("correctif B : FACT/ambiguous + ['fact_assertion','negated_assertion_claim'] → non admissible", () => {
    const intent: IntentResult = { intent: 'FACT', confidence: 'ambiguous', signals: ['fact_assertion', 'negated_assertion_claim'] }
    expect(isP6MultiSegmentAdmissible(intent)).toBe(false)
  })

  it("correctif B : OBSERVATION/ambiguous + ['observation_state','negated_assertion_claim'] → non admissible", () => {
    const intent: IntentResult = { intent: 'OBSERVATION', confidence: 'ambiguous', signals: ['observation_state', 'negated_assertion_claim'] }
    expect(isP6MultiSegmentAdmissible(intent)).toBe(false)
  })

  it("correctif B : témoin positif — FACT/ambiguous + ['fact_assertion'] seul (sans négation) → admissible", () => {
    const intent: IntentResult = { intent: 'FACT', confidence: 'ambiguous', signals: ['fact_assertion'] }
    expect(isP6MultiSegmentAdmissible(intent)).toBe(true)
  })

  // ── Recette terrain item 5 (Vincent 2026-08-19) — segment FACT négatif dans un
  // multi réel → non admissible dès le gate, tout-ou-rien → fallback mono ─────
  it('recette 5 : "Je ne considère pas que R4 est réglé, crée une action pour vérifier la grille demain." → segment FACT négatif non admissible, fallback mono', async () => {
    const NEGATED_FACT_R4 = 'Je ne considère pas que R4 est réglé'
    const CREATE_ACTION_GRILLE = 'crée une action pour vérifier la grille demain.'
    const question = `${NEGATED_FACT_R4}, ${CREATE_ACTION_GRILLE}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, NEGATED_FACT_R4), seg(question, CREATE_ACTION_GRILLE)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposals')

    expect(prep._diag.p6Attempted).toBe(true)
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('segment_not_admissible')
    expect(prep._diag.p6ProposalCount).toBe(0)
    expect(prep._diag.p6Segments[0].intent).toBe('FACT')
    expect(prep._diag.p6Segments[0].signals).toContain('negated_assertion_claim')
    expect(prep._diag.p6Segments[0].admissible).toBe(false)
    expect(prep._diag.p6Segments[0].rejectionReason).toBe('not_admissible')
    // Repli immédiat au premier échec : le second segment n'a jamais été résolu.
    expect(prep._diag.p6Segments[1].resultKind).toBeNull()
  })

  // ── Complémentaire — un segment retourne clarification → fallback mono total ─
  it('complémentaire : un segment qui retourne clarification → fallback mono total', async () => {
    // Deux candidats pour "cadenas" → resolveWriteBranch retourne kind:'clarification'
    // pour ce segment OBSERVATION (toujours admissible, mais pas résolu avec certitude).
    resolveCanonicalSubjectReference.mockImplementation(async (_siteId: string, label: string) =>
      label === 'cadenas'
        ? { kind: 'ambiguous' as const, candidates: [{ id: 'a', label: 'Cadenas portail' }, { id: 'b', label: 'Cadenas local' }] }
        : { kind: 'not_found' as const })
    const question = `${OBS_CADENAS} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, OBS_CADENAS), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposals')
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('segment_resolution_not_proposal')
    expect(prep._diag.p6Segments[0].admissible).toBe(true)
    expect(prep._diag.p6Segments[0].resultKind).toBe('clarification')
    expect(prep._diag.p6Segments[0].rejectionReason).toBe('resolution_not_proposal')
  })

  // ── Complémentaire — un segment retourne answer → fallback mono total ───────
  it('complémentaire : un segment qui retourne answer → fallback mono total', async () => {
    // "cadenas" jamais résolu (not_found, défaut du mock) → resolveWriteBranch
    // retourne kind:'answer' pour ce segment OBSERVATION (pas de brouillon possible).
    const question = `${OBS_CADENAS} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, OBS_CADENAS), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposals')
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('segment_resolution_not_proposal')
    expect(prep._diag.p6Segments[0].resultKind).toBe('answer')
    expect(prep._diag.p6Segments[0].rejectionReason).toBe('resolution_not_proposal')
  })

  // ── Complémentaire — le fallback mono ne rappelle jamais P6 ─────────────────
  it('complémentaire : preuve que le fallback mono ne rappelle pas récursivement P6', async () => {
    const question = `${UNKNOWN_SIGNALEMENT} ${CREATE_ACTION_PRESTA}`
    decomposeUtterance.mockResolvedValue({
      segments: [seg(question, UNKNOWN_SIGNALEMENT), seg(question, CREATE_ACTION_PRESTA)],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    // Un seul appel au décomposeur pour toute la requête, malgré le repli.
    expect(decomposeUtterance).toHaveBeenCalledTimes(1)
    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    // Le mono reprend sur la question ENTIÈRE (pas un segment) : le brouillon
    // produit porte le texte complet, preuve qu'aucun second passage P6 n'a eu lieu.
    expect(prep.result.kind).toBe('proposal')
    if (prep.result.kind !== 'proposal') throw new Error('unreachable')
    // `body` est toujours null pour une proposition action/generic (buildCopilotProposal) —
    // la preuve passe par `title`, dérivé de la question ENTIÈRE : si le mono avait
    // rejoué seulement le segment "Crée une action…", le préfixe de titre l'aurait
    // stripé et le titre commencerait par "Une action…", pas par le premier segment.
    expect(prep.result.proposal.title).toBe(question.trim())
  })

  // ── Mandat Vincent (2026-08-19) — verrou sémantique commun de resolveWriteBranch ──
  // hasWriteBlockingSemanticSignal() ne protégeait auparavant que la branche FACT
  // (garde retirée, cf. lib/visits/copilot-free-prepare.ts). Le verrou est
  // désormais posé en tête de resolveWriteBranch, avant toute branche métier, et
  // s'applique quel que soit intentResult.intent. Les 6 tests suivants reprennent
  // verbatim la liste transmise par Vincent.

  // ── 1. CREATE_ACTION/strong + negated_assertion_claim → aucune proposition ──
  it('verrou commun 1 : CREATE_ACTION/strong + negated_assertion_claim → aucune proposition', async () => {
    const question = 'Je ne considère pas que le SSI soit réglé. Crée une action pour vérifier la grille demain.'
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposal')
    expect(prep.result.kind).not.toBe('proposals')
  })

  // ── 2. CREATE_ACTION/strong + negated_write_verb → aucune proposition ───────
  // negated_write_verb n'est posé par le routeur QUE lorsque isFullyNegatedWriteIntent()
  // est vrai — aucune clause de la phrase ne porte de verbe d'écriture positif
  // (copilot-intent-router.ts:405-421). Or CHAQUE branche 'strong' du routeur
  // (CREATE_ACTION inclus, ligne 879) exclut elle-même !hasNegatedWrite avant de
  // retourner : CREATE_ACTION/strong + negated_write_verb est donc structurellement
  // inatteignable en sortie de detectIntent(). mergeComprehension ne peut pas non
  // plus produire cette combinaison : son seul chemin de promotion vers une
  // écriture (possible_write_refined) est lui-même bloqué par
  // hasWriteBlockingSemanticSignal (copilot-comprehension.ts:427). Le plus proche
  // équivalent réellement atteignable est UNKNOWN_WRITE/ambiguous (négation totale
  // d'un seul verbe d'écriture) — ce test vérifie que le verrou couvre bien cet
  // intent-là aussi, même si UNKNOWN_WRITE était déjà sûr par construction avant
  // ce correctif (sa branche historique ne produit qu'une clarification). La
  // propriété générale « n'importe quel intent, n'importe quel signal bloquant »
  // reste couverte au niveau unitaire par hasWriteBlockingSemanticSignal
  // (tests/lib/copilot-intent-router.test.ts, describe "propriété centrale sticky").
  it('verrou commun 2 : UNKNOWN_WRITE/ambiguous + negated_write_verb → aucune proposition (verrou déclenché en premier)', async () => {
    const question = "Ne crée pas d'action pour vérifier la grille."
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposal')
    expect(prep.result.kind).not.toBe('proposals')
    // Le texte prouve que c'est le NOUVEAU verrou commun qui a répondu, pas
    // l'ancienne branche UNKNOWN_WRITE (qui renvoie "Je n'ai pas bien compris…").
    expect(prep.result.kind).toBe('answer')
    if (prep.result.kind !== 'answer') throw new Error('unreachable')
    expect(prep.result.text).toContain('rejette une affirmation')
  })

  // ── 3. CREATE_WATCHPOINT/strong + signal bloquant → aucune proposition ──────
  it('verrou commun 3 : CREATE_WATCHPOINT/strong + negated_assertion_claim → aucune proposition', async () => {
    const question = 'Je ne considère pas que le SSI soit réglé. Surveille le SSI.'
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposal')
    expect(prep.result.kind).not.toBe('proposals')
  })

  // ── 4. SCHEDULE_MEETING/strong + signal bloquant → aucune proposition ───────
  it('verrou commun 4 : SCHEDULE_MEETING/strong + negated_assertion_claim → aucune proposition', async () => {
    const question = 'Je ne considère pas que la réunion soit nécessaire. Planifie une réunion demain à 9h.'
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: false,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposal')
    expect(prep.result.kind).not.toBe('proposals')
  })

  // ── 5. Témoins positifs identiques sans signal bloquant → propositions inchangées ──
  it('verrou commun 5 : témoins positifs — CREATE_ACTION/CREATE_WATCHPOINT/SCHEDULE_MEETING sans négation → propositions inchangées', async () => {
    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')

    const cases: [string, string][] = [
      ['Crée une action pour vérifier la grille demain.', 'action'],
      ['Surveille le SSI.', 'watchpoint'],
      ['Planifie une réunion demain à 9h.', 'schedule_meeting'],
    ]

    for (const [question, expectedKind] of cases) {
      decomposeUtterance.mockResolvedValue({
        segments: [{ start: 0, end: question.length, dependsOn: null }],
        ambiguous: false,
      })
      const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })
      expect(prep.kind).toBe('result')
      if (prep.kind !== 'result') throw new Error('unreachable')
      expect(prep.result.kind).toBe('proposal')
      if (prep.result.kind !== 'proposal') throw new Error('unreachable')
      expect(prep.result.proposal.kind).toBe(expectedKind)
    }
  })

  // ── 6. Rejeu end-to-end de la phrase terrain exacte (tour [6], 2026-08-19) ──
  it('verrou commun 6 : phrase terrain exacte tour [6], décomposition ambiguous:true/1 segment → jamais proposal', async () => {
    const question = 'Je ne considère pas que R4 est réglé. Crée une action pour vérifier la grille demain.'
    decomposeUtterance.mockResolvedValue({
      segments: [{ start: 0, end: question.length, dependsOn: null }],
      ambiguous: true,
    })

    const { prepareCopilotAnswer } = await import('@/lib/visits/copilot-free-prepare')
    const prep = await prepareCopilotAnswer({ siteId: SITE_ID, question })

    expect(prep.kind).toBe('result')
    if (prep.kind !== 'result') throw new Error('unreachable')
    expect(prep.result.kind).not.toBe('proposal')
    expect(prep.result.kind).not.toBe('proposals')
    expect(prep._diag.p6Decision).toBe('mono_fallback')
    expect(prep._diag.p6FallbackReason).toBe('ambiguous_decomposition')
    expect(prep._diag.p6ProposalCount).toBe(0)
  })
})
