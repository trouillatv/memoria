import { describe, it, expect } from 'vitest'
import {
  buildSemanticCandidatePool,
  buildSubjectSemanticContext,
  decideSemanticMatch,
  resolveSemanticFallback,
  SEMANTIC_POOL_CAP,
  type JudgeFn,
  type SemanticCandidate,
} from '@/lib/db/canonical-subject-semantic-fallback'

// P1-C2b — rapprochement sémantique inter-années, dernier recours, pool borné, juge réutilisé.
// Les tests injectent un juge déterministe (simulant le verdict qu'un LLM correct rendrait) pour
// valider MA logique d'orchestration/décision. Les vrais verdicts LLM sont validés par le dry-run.

// Juge simulé : verdict par paire de labels (source, candidat).
function fakeJudge(map: Record<string, { verdict: string; score: number }>): JudgeFn {
  return async (a, b) => map[`${a.label}|${b.label}`] ?? { verdict: 'distinct', score: 10 }
}

const MALL = { id: 'mall', label: 'Dégagement extérieur du Mall', occurrenceContext: 'encombré par armoires froid — issue vers le mall, évacuation, réservée au personnel' }
const FOODCOURT: SemanticCandidate = { id: 'fc', label: 'Issue de Secours du food court', occurrenceContext: 'largeur réduite par frigos — utilisée par le personnel' }
const REGISTRE: SemanticCandidate = { id: 'reg', label: 'Registre de sécurité installations électriques non renseigné', occurrenceContext: 'registre non renseigné' }
const SPRINKLER: SemanticCandidate = { id: 'spk', label: 'Têtes de Sprinkler dégagées' }

describe('buildSemanticCandidatePool — cap dur', () => {
  it('exclut le sujet lui-même', () => {
    const { pool } = buildSemanticCandidatePool('a', [{ id: 'a', label: 'X' }, { id: 'b', label: 'Y' }])
    expect(pool.map((c) => c.id)).toEqual(['b'])
  })
  it('au-delà du cap → skip, pool vide (aucun appel juge non borné)', () => {
    const many = Array.from({ length: SEMANTIC_POOL_CAP + 1 }, (_, i) => ({ id: `c${i}`, label: `L${i}` }))
    const { pool, skipped } = buildSemanticCandidatePool('self', many)
    expect(skipped).toBe(true)
    expect(pool).toHaveLength(0)
  })
})

describe('buildSubjectSemanticContext — contexte compact déterministe', () => {
  it('concatène labels + notes, déduplique, tronque', () => {
    const ctx = buildSubjectSemanticContext(['Issue food court', 'Issue food court'], ['largeur réduite par frigos'])
    expect(ctx).toContain('Issue food court')
    expect(ctx).toContain('frigos')
    expect(ctx.split('Issue food court').length - 1).toBe(1) // dédupliqué
  })
})

describe('decideSemanticMatch — favorise le faux négatif', () => {
  it('same_subject unique ≥ seuil → match', () => {
    expect(decideSemanticMatch([{ candidateId: 'x', verdict: 'same_subject', score: 88 }]).matchId).toBe('x')
  })
  it('same_subject sous le seuil → aucun match', () => {
    expect(decideSemanticMatch([{ candidateId: 'x', verdict: 'same_subject', score: 60 }]).matchId).toBeNull()
  })
  it('deux same_subject proches → ambigu, aucun match', () => {
    const d = decideSemanticMatch([
      { candidateId: 'x', verdict: 'same_subject', score: 85 },
      { candidateId: 'y', verdict: 'same_subject', score: 80 },
    ])
    expect(d.matchId).toBeNull()
    expect(d.reason).toBe('ambiguous_multiple_same_subject')
  })
  it('deux same_subject avec marge nette → gagnant', () => {
    expect(decideSemanticMatch([
      { candidateId: 'x', verdict: 'same_subject', score: 92 },
      { candidateId: 'y', verdict: 'same_subject', score: 72 },
    ]).matchId).toBe('x')
  })
  it('related/distinct/uncertain → aucun match', () => {
    expect(decideSemanticMatch([
      { candidateId: 'r', verdict: 'related', score: 65 },
      { candidateId: 'd', verdict: 'distinct', score: 20 },
      { candidateId: 'u', verdict: 'uncertain', score: 40 },
    ]).matchId).toBeNull()
  })
})

describe('resolveSemanticFallback — bout en bout (juge injecté)', () => {
  it('MUST MATCH : Mall ↔ food court (same_subject) → rattachement', async () => {
    const judge = fakeJudge({ 'Dégagement extérieur du Mall|Issue de Secours du food court': { verdict: 'same_subject', score: 90 } })
    const res = await resolveSemanticFallback(MALL, [FOODCOURT, SPRINKLER], judge)
    expect(res.matchId).toBe('fc')
    expect(res.judgeCalls).toBe(2)
  })

  it('MUST NOT MATCH : électrique vs registre (related) → aucun rattachement', async () => {
    const judge = fakeJudge({ 'Contrôle des installations électriques|Registre de sécurité installations électriques non renseigné': { verdict: 'related', score: 55 } })
    const src = { id: 'elec', label: 'Contrôle des installations électriques', occurrenceContext: 'contrôlé par Bureau Veritas, absence d’observations' }
    const res = await resolveSemanticFallback(src, [REGISTRE], judge)
    expect(res.matchId).toBeNull()
    expect(res.reason).toBe('no_same_subject')
  })

  it('MUST NOT MATCH : friteuse vs appareils cuisson (distinct) → aucun', async () => {
    const judge = fakeJudge({ 'Extinction friteuse|Contrôle des appareils de cuisson': { verdict: 'distinct', score: 15 } })
    const res = await resolveSemanticFallback({ id: 'frit', label: 'Extinction friteuse' }, [{ id: 'cuis', label: 'Contrôle des appareils de cuisson' }], judge)
    expect(res.matchId).toBeNull()
  })

  it('AMBIGU : deux candidats same_subject proches → aucun auto-match', async () => {
    const judge = fakeJudge({
      'Issue Mall|Issue de Secours du food court': { verdict: 'same_subject', score: 84 },
      'Issue Mall|Sortie de secours zone A': { verdict: 'same_subject', score: 82 },
    })
    const res = await resolveSemanticFallback(
      { id: 'src', label: 'Issue Mall' },
      [FOODCOURT, { id: 'zA', label: 'Sortie de secours zone A' }],
      judge,
    )
    expect(res.matchId).toBeNull()
    expect(res.reason).toBe('ambiguous_multiple_same_subject')
  })

  it('CAP : > 20 candidats → skip sûr, 0 appel juge', async () => {
    let calls = 0
    const judge: JudgeFn = async () => { calls++; return { verdict: 'same_subject', score: 99 } }
    const many = Array.from({ length: SEMANTIC_POOL_CAP + 5 }, (_, i) => ({ id: `c${i}`, label: `L${i}` }))
    const res = await resolveSemanticFallback({ id: 'src', label: 'S' }, many, judge)
    expect(res.skipped).toBe(true)
    expect(res.matchId).toBeNull()
    expect(calls).toBe(0)
  })

  it('CONTEXTE : le contexte d’occurrence est bien transmis au juge', async () => {
    let seenContextA: string | null | undefined
    let seenContextB: string | null | undefined
    const judge: JudgeFn = async (a, b) => { seenContextA = a.occurrenceContext; seenContextB = b.occurrenceContext; return { verdict: 'distinct', score: 10 } }
    await resolveSemanticFallback(MALL, [FOODCOURT], judge)
    expect(seenContextA).toContain('armoires froid')
    expect(seenContextB).toContain('frigos')
  })

  it('acteur ↔ sujet métier : hors périmètre (pool ne contient pas d’acteurs — filtré en amont)', async () => {
    // Le préfiltre kind<>actor est fait par l'appelant (existingCs). Ici on documente que
    // resolveSemanticFallback ne connaît que le pool fourni : aucun acteur ne peut y entrer.
    const judge = fakeJudge({})
    const res = await resolveSemanticFallback({ id: 'src', label: 'Nettoyage conduits' }, [], judge)
    expect(res.reason).toBe('empty_pool')
    expect(res.matchId).toBeNull()
  })
})
